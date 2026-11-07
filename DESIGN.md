# Design decisions

One entry per decision: the problem, what I chose, what I considered instead, and the trade-off. Everything marked **checked** was verified by running it; everything marked **not checked** was reasoned but not reproduced.

## 1. Deduplicate alerts in the database, not in application code

- **Problem:** many dangerous readings arrive for the same condition. One alert should exist, not hundreds.
- **First version:** check whether an active alert exists, then insert one. Two simultaneous requests both saw "none" and both inserted, so two alerts existed (reproduced).
- **Chosen:** a partial unique index on `alerts (patient_id, vital_type) WHERE status = 'active'`, and one `INSERT ... ON CONFLICT ... DO UPDATE` statement. The database enforces the rule, so it holds however many servers run.
- **Alternatives:** an in-memory lock (breaks with more than one server); `SELECT ... FOR UPDATE` before inserting (more round trips, and it still needs a unique rule for the first insert).
- **Trade-off:** the alert's identity is (patient, vital) while active. Deduplication is not trend detection: a worsening heart rate does not raise a new alert.
- **Checked:** automated test, 20 concurrent upserts give 1 alert; the test fails when the index is removed.

## 2. Save the reading first, then evaluate it

- **Problem:** data capture must not depend on alert logic.
- **Chosen:** the reading is always inserted; the alert logic runs after it. Both happen inside one transaction (see 4), so a failure removes both.
- **Trade-off:** the first version kept the reading even if the alert code failed. I replaced that with all-or-nothing, because a reading with a half-made alert is worse than a rejected request the client can retry.

## 3. Notify through a queue, only when a new alert is created

- **Problem:** a slow notification channel must not slow ingestion, and repeated readings must not re-notify.
- **Chosen:** RabbitMQ, a durable queue, persistent messages, manual acknowledgement after the work is done. A message is created only when the upsert created a **new** alert.
- **Alternative:** notify directly in the request (simple, but ingestion would wait for notification and a notifier outage would break ingestion).
- **Trade-off:** at-least-once delivery, so the consumer must be idempotent (see 8).

## 4. Outbox: write the "please publish" note in the same transaction as the alert

- **Problem:** saving to Postgres and publishing to RabbitMQ are two systems; no command makes both succeed together. A crash between them left an active alert with no message, and deduplication then kept every later reading silent, so the nurse was never told (reproduced on the real system).
- **Chosen:** an `outbox` table. The route saves the reading, the alert and the outbox row in one transaction. A loop publishes unsent rows and then sets `published_at`. `published_at` has no default: `NULL` means "not sent yet".
- **Alternatives:** publish before committing (a rollback would leave a message for an alert that does not exist); two-phase commit (heavy and not supported by this stack); doing nothing and hoping.
- **Order inside the loop:** send first, confirm, tick second. A crash in between causes a duplicate, never a loss.
- **Measured trade-off:** my first loop sent 10 notes per 2-second round (about 5 alerts per second). A burst of 133 new alerts (2,000 readings at 200/s for 10 s) reached the nurse after a median of 11.4 s, p95 18.2 s, max 18.9 s, even though the API answered in 15 ms. A simple queue model of "5 per second" predicted a p95 of 16 s. I changed the loop to batches of up to 100: one broker confirmation and one `UPDATE ... WHERE id = ANY(...)` per batch, the next round at once while a batch is full, and a 0.5 s poll when idle. The same test then gave a median of 0.29 s, p95 0.51 s, max 0.54 s. The remaining delay is mostly the poll interval. Alternatives: a shorter interval, or Postgres LISTEN/NOTIFY (not done).
- **Other trade-offs:** five database round trips per request instead of three. Outbox rows are never deleted, and the poll has no partial index on unsent rows. Several API instances could publish the same row twice; `FOR UPDATE SKIP LOCKED` is the usual fix and is not implemented.
- **Checked:** a crash before `COMMIT` left no reading, alert or note; an alert created while RabbitMQ was down was delivered after it returned; the batched loop was first checked against a fake broker (250 waiting notes drained in 33 ms, a failed confirm left everything unticked and resent it, broker down ticked nothing). Not automated in the repository tests.

## 5. Wait for the broker's confirmation before marking a note sent

- **Problem:** `sendToQueue` returns when the bytes leave the program, not when RabbitMQ has the message. A connection dying in that gap would tick the note for a message that never arrived.
- **Chosen:** a confirm channel and `await channel.waitForConfirms()` between sending and ticking. If the wait fails, the batch stays unticked and is sent again.
- **Checked:** the channel shows confirm mode in the RabbitMQ UI and the normal flow works. **Not checked:** the failure window itself is too small to trigger on purpose.

## 6. Reconnect with amqplib's recovery

- **Problem:** stopping RabbitMQ crashed the API, and a restart left the consumer silent.
- **Chosen:** the library's `recovery` option (redial with growing waits, capped at 10 s). The old channel does not survive a reconnect, so a `setup` function creates a new channel, declares the topology, and (in the consumer) starts consuming again after every reconnect. The API sets its channel to `null` while disconnected and the outbox loop skips those rounds. An `error` listener is required, otherwise Node treats the event as fatal.
- **Alternative:** hand-written retry timers (more code and more bugs for the same result).
- **Trade-off:** an alert created during an outage is **delayed**, not lost.
- **Checked:** manual `docker stop` and `docker restart rabbitmq` with both processes running, on a laptop and inside Docker.
- **Not covered:** a channel closing while the connection stays up.

## 7. Retries with a TTL queue and a dead-letter queue

- **Problem:** if nobody is on duty when the message is processed, it should be tried again later, but a failing message must not loop forever.
- **Chosen:** the consumer copies the message to `alert-dispatch-retry` (10 second TTL, dead-letters back to the main queue) with its own `x-attempts` header, and after 3 tries rejects it to `alert-dlx`, so it lands in `alert-dispatch-dlq` where it can be inspected.
- **Alternatives:** requeueing immediately (a tight loop); relying on AMQP's `redelivered` flag (it is a boolean, not a counter, and showed `false` throughout the experiment).
- **Trade-off:** any exception in the consumer dead-letters the message immediately, with no retry for transient database errors. The send to the retry queue is not confirmed.
- **Checked:** three tries, then the message appeared in the dead-letter queue.

## 8. Consumer: notify first, then record; skip anyone already notified

- **Chosen:** one SQL query returns the staff on duty for the patient's ward plus an `already_notified` flag. For each person not yet notified: notify, then insert into `alert_dispatches` (`UNIQUE (alert_id, staff_id)`).
- **Two separate questions:** "is anyone on duty?" (empty means retry) and "were they already told?" (skip). Merging them makes "everyone was already told" look like "nobody is on duty".
- **Alternative:** record first, then notify (never a duplicate, but a crash in between loses the notification).
- **Trade-off:** I chose a possible duplicate over a possible miss. In an alert system, a missed alert is the worse failure.
- **Checked:** "Already notified ..., skipping" appears for a repeated message.

## 9. The database is the truth; the WebSocket is a nudge

- **Problem:** an alert reached a dashboard only at the moment it happened. With no page open, the nurse was still recorded as notified, and a page opened later showed nothing.
- **Chosen:** `GET /alerts/active`. The dashboard loads active alerts when it opens and on every reconnect, refreshes every 15 seconds (so resolved alerts disappear), and treats a WebSocket message as "something changed": show a banner, then ask the database again. The page writes all text with `textContent`, so a patient name cannot inject HTML.
- **Alternatives:** guaranteed delivery over the WebSocket with acknowledgements and replay (a protocol to design, test and maintain); Socket.io (extra weight for one message type).
- **Trade-off:** "notified" in the ledger means "pushed", not "seen". The alert stays visible until someone resolves it, which is what protects the patient.
- **Limits:** no login; every viewer sees every active alert; the WebSocket port is hard-coded in the page.
- **Checked:** opened the page with nothing happening and it showed the active alerts; a resolved alert disappeared by itself; a new alert appeared with a banner and no refresh.

## 10. Validate at the door

- **Problem:** bad input only failed inside Postgres, so the client got a `500` for its own mistake.
- **Chosen:** `validateVitalReading` returns a message or `null` and runs before any database connection is borrowed; the route answers `400`. `value` must be a real JSON number: the text `"125"` is rejected on purpose, because a sensor sending text is sending something unexpected and a clear error is better than guessing.
- **Trade-off:** only this route is validated so far; the vital types in the code must be kept in step with the database enum.
- **Checked:** unit tests, and each bad input gave its own `400`.

## 11. Data model choices

- **UUID primary keys** (`gen_random_uuid()`): ids are not guessable and records can be created anywhere. A sequence would also have worked inside a single database.
- **Ward is a plain integer** and staff are linked through `ward_staff_assignments` with shift times, because one column cannot hold several staff per ward.
- **ENUMs** for `vital_type` and alert status (integrity; the cost is an `ALTER TYPE` to add a value), **NUMERIC** for values (no float rounding), **TIMESTAMPTZ** everywhere (timezone safety).
- **Known weakness:** the shift columns are nullable, and a null silently excludes that staff member from the on-duty query.

## 12. Configuration, tests and CI

- **Configuration:** `config.js` reads environment variables with defaults that work on a laptop, so Docker can override them without code changes. It is the only place that loads `.env`.
- **Tests:** unit tests for the rules, plus a database test against a disposable Postgres in Docker. The database test builds the schema from `schema.sql` twice, uses the **same SQL** as the API (`sql.js`, so the test cannot drift from the code), and refuses to run on any host except localhost. I checked that the tests have teeth by removing the unique index and watching all three fail.
- **CI:** GitHub Actions runs the unit tests and the database tests on every push, on a fresh machine, with Node 22 and 24. This catches "works only on my PC" mistakes; an early commit once left out `config.js` and GitHub's copy could not start.
- **Gap:** the HTTP route and the failure scenarios above are checked by hand, not by automated tests.

## 13. Docker stack and graceful shutdown

- **Problem:** the system needed several programs and a database running together, and `docker stop` sends `SIGTERM` and kills the process after 10 seconds. A Node program that ignores `SIGTERM` makes every stop wait the full 10 seconds and die in the middle of its work.
- **Chosen:**
  - One image (`node:22-alpine`, `npm ci --omit=dev`, runs as the `node` user) used for both the API and the consumer.
  - `.dockerignore` keeps `.env` out of the image; without it, `COPY . .` would copy the database password into the image.
  - `docker-compose.yml` has a disposable test database that is always available, and an `app` profile with `db`, `rabbitmq`, `api` and `consumer`. The database runs `schema.sql` and `seed.sql` once, when it is first created. Containers reach each other by service name.
  - The API handles `SIGTERM`/`SIGINT`: stop the outbox loop, let running requests finish, close idle connections every 100 ms, close the database pool, exit, with a 10-second forced exit as a safety net. The consumer exits at once, which is safe because a message that was not acknowledged is redelivered and the ledger prevents a double notification.
- **Found while testing:** `server.close()` alone took 5.8 s because a keep-alive connection stayed open. Closing idle connections in a 100 ms loop brought the stop to 1.7 s, the time the running request still needed.
- **Alternatives:** doing nothing (every stop takes 10 s); an init process such as tini (fixes signal forwarding but does not close connections cleanly).
- **Checked:** `docker compose stop api` took 0.4 s and logged "Shutdown complete"; the whole stack starts from an empty volume with one command; both processes reconnected after `docker compose restart rabbitmq`.
- **Trade-off:** the API runs from an image, so code changes need a rebuild (`--build`) before the container uses them.

## 14. Performance: where the limit is

- **Method:** `load-test.js` is an open-loop generator: requests leave on schedule even if earlier ones are still waiting, so a slow server shows up as slow answers instead of a quietly reduced load. `ladder.sh` runs several rates, each on a fresh database. Alert delay is measured in SQL as `delivered_at - created_at`.
- **Rules written before running:** a rate is "sustained" only if every reading got a `201`, the generator kept up with its target, p95 latency stayed under 100 ms, and every alert reached the nurse with a p95 alert delay under 2 s.
- **Result** (one run per rate, 10 s, 50 patients, one API and one consumer, load generator on the same Windows PC):

| Rate | Success | p50 / p95 / p99 latency | Alerts delivered | p95 alert delay |
|---|---|---|---|---|
| 200/s | 100% | 6 / 13 / 23 ms | 125 of 125 | 0.50 s |
| 400/s | 100% | 6 / 17 / 34 ms | 150 of 150 | 0.52 s |
| 800/s | 100% | 7 / 165 / 334 ms | 149 of 149 | 0.63 s |
| 1,200/s | 100% | 66 / 1,432 / 2,115 ms | 150 of 150 | 1.31 s |

- **Sustained by those rules: 400 readings/s.** Above that nothing failed and no alert was lost; the system queued instead of dropping work.
- **Cause:** during an 800/s run the API container used about one full CPU core while PostgreSQL used about 70% of a core, so the single Node thread is the bottleneck. Each reading costs five database round trips. The per-request cost was inferred from CPU use, not profiled.
- **Not done, and why:** one SQL statement with CTEs would cut the round trips but make the query harder to read; several API processes would need `FOR UPDATE SKIP LOCKED` in the outbox loop so the same note is not published twice. I stopped here to document and finish instead.
- **Caveats:** single 10-second runs on one machine; every run created at most about 150 alerts (50 patients x 3 vitals), so the notification path was only lightly stressed; alert delay is measured until the consumer wrote its ledger row, not until a person saw the alert; a run made while sampling CPU gave much worse latency than a clean run, so measurement can disturb the thing measured.

## What I would do next

1. Run several API processes: `FOR UPDATE SKIP LOCKED` in the outbox loop so a note is not published twice, plus a partial index on unsent notes and cleanup of old outbox rows.
2. Do less work per request (for example one SQL statement instead of five round trips), after profiling; the API's single Node thread is the measured limit.
3. Retry transient database errors in the consumer and confirm its sends to the retry queue.
4. Authentication, and sending alerts only to the staff they concern.
5. Structured logging, health checks and rate limiting.
6. Redis only if a measurement shows a slow path worth caching.
