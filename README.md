# Patient Alert Dispatch System

![CI](https://github.com/Himaninayyar/patient-alert-system/actions/workflows/ci.yml/badge.svg)

> **Student project.** Fictional data only. Not a clinically validated system and not for real patients.

A backend that takes patient vital-sign readings, decides whether a reading is dangerous, raises **one** alert per ongoing problem, queues it durably, finds the staff on duty for that patient's ward, and notifies them live on a dashboard. Notification is simulated (console + WebSocket page); there is no real SMS or push.

The goal of the project is reliability under failure: **never lose an alert, never spam the same nurse.** Design reasons and trade-offs are in [DESIGN.md](DESIGN.md).

## Quick start (Docker)

Requirements: Docker Desktop, and these ports free: 3000, 8080, 5672, 15672.

```bash
docker compose --profile app up -d --build --wait
```

This starts PostgreSQL (tables and a demo patient and nurse are created automatically), RabbitMQ, the API and the consumer. The first run downloads images and takes a few minutes.

1. Open the dashboard: http://localhost:3000/dashboard.html (it says "No active alerts").
2. Send a dangerous reading for the demo patient:

```bash
curl -X POST http://localhost:3000/vital-readings -H "Content-Type: application/json" \
  -d '{"patient_id":"00000000-0000-0000-0000-000000000001","vital_type":"temperature","value":41}'
```

A yellow banner ("New alert for Nurse Priya ...") and an alert card appear within a second or two.

A second dangerous reading for the same patient and vital only updates the existing alert. To allow a new one, find the alert with `GET /alerts/active` and resolve it:

```bash
curl -X PATCH http://localhost:3000/alerts/<alert_id>/resolve
```

Useful commands:

```bash
docker compose --profile app logs -f api consumer   # watch what happens
docker compose --profile app down                   # stop (data is kept)
docker compose --profile app down -v                # stop and wipe the data
```

RabbitMQ management UI: http://localhost:15672 (login `guest` / `guest`, local use only).

## How it works

```
Client ──HTTP──► API (Express :3000) ──SQL──► PostgreSQL
                   │  saves reading + alert + outbox note in ONE transaction
                   │  outbox loop: send a batch, wait for the broker's confirm, then tick the batch
                   ▼
              RabbitMQ  alert-dispatch ──► Consumer ──SQL──► PostgreSQL
                 ▲  │  nobody on duty: retry queue (10 s), 3 tries, then dead-letter queue
                 │  ▼
                 │  Consumer's WebSocket server (:8080) ──► Dashboard (public/dashboard.html)
                 └── retry queue
```

Two Node processes: the **API** (`index.js`, with `outbox-publisher.js` inside it) and the **consumer** (`alert-consumer.js`, which also hosts the WebSocket server).

1. `POST /vital-readings` validates the input (400 on bad data).
2. In one database transaction it saves the reading, and if the reading is dangerous, upserts the alert and, only for a **new** alert, writes a note to the `outbox` table.
3. A loop reads unsent outbox notes in batches of up to 100, publishes them to RabbitMQ, waits for the broker's confirmation, and only then marks them sent.
4. The consumer finds the on-duty staff of the patient's ward, skips anyone already notified, notifies the rest (console + WebSocket), and records them in `alert_dispatches`.
5. The dashboard asks the database for active alerts when it opens and every 15 seconds, and uses the WebSocket only as a live nudge.

Danger rules (`thresholds.js`): heart rate above 120, SpO2 below 92, temperature above 38. Blood pressure has no rule yet.

## What is guaranteed, and how it was checked

| Guarantee | How it works | Evidence |
|---|---|---|
| One active alert per patient and vital, even under simultaneous requests | Partial unique index + `INSERT ... ON CONFLICT` | Automated: 20 concurrent readings give exactly 1 alert; the test fails if the index is removed |
| An alert is never saved without being queued | Outbox row written in the same transaction as the alert | Manual: a crash before `COMMIT` left nothing saved; an alert created while RabbitMQ was down was delivered after it returned |
| Survives a RabbitMQ restart (API and consumer) | amqplib `recovery`: redial with backoff, then new channel and listening again | Manual: `docker stop` / `docker restart rabbitmq` under running processes, on a laptop and inside Docker |
| A note is marked sent only after the broker confirms it | Confirm channel + `waitForConfirms()` | Channel shown in confirm mode in the RabbitMQ UI; the failure window itself was not reproduced |
| A nurse is not notified twice for the same alert | `alert_dispatches` with `UNIQUE (alert_id, staff_id)` checked before notifying | Seen in the consumer log: "Already notified ..., skipping" |
| Nobody on duty does not lose the alert | Retry queue (10 s, up to 3 tries), then a dead-letter queue | Seen: 3 tries then the message in the dead-letter queue |
| Bad input is rejected early | `validation.js`, before any database connection | Unit tests and manual 400 responses |
| Stopping is clean | `SIGTERM` handler: finish running requests, close connections | `docker compose stop api` took 0.4 s and logged "Shutdown complete" |

Delivery is **at-least-once**: a crash can cause a duplicate message, which the idempotent consumer ignores.

## Performance (measured)

Setup: one API container, one consumer, PostgreSQL and RabbitMQ, all in Docker on one Windows PC, with the load generator on the same PC. 10-second runs, 50 patients, a fresh database for every rate, one run per rate. The numbers describe this setup only.

A rate counts as **sustained** if: every reading got a `201`, the generator kept up with its target rate, p95 latency stayed under 100 ms, and every alert reached the nurse with a p95 alert delay under 2 s.

| Rate | Success | p50 / p95 / p99 latency | Alerts delivered | p95 alert delay | Sustained? |
|---|---|---|---|---|---|
| 200/s | 100% | 6 / 13 / 23 ms | 125 of 125 | 0.50 s | yes |
| 400/s | 100% | 6 / 17 / 34 ms | 150 of 150 | 0.52 s | yes |
| 800/s | 100% | 7 / 165 / 334 ms | 149 of 149 | 0.63 s | no (p95 over 100 ms) |
| 1,200/s | 100% | 66 / 1,432 / 2,115 ms | 150 of 150 | 1.31 s | no |

- **Sustained: 400 readings/s.** Above that nothing failed and no alert was lost; responses just got slower.
- During an 800/s run the API process used about one full CPU core while PostgreSQL used about 70% of a core. The single Node thread is the limit.
- **A bottleneck found by measuring:** the first outbox loop sent 10 notes every 2 seconds (about 5 alerts/s). In a burst of 133 alerts the nurse was told after a median of **11.4 s** (p95 18.2 s) although the API answered in 15 ms. Sending batches of 100 brought it to a median of **0.29 s** (p95 0.51 s) on the same test.
- **Limits of these numbers:** one machine, single runs, at most about 150 alerts per run (50 patients x 3 vitals), so the notification path was only lightly stressed. Alert delay is measured until the consumer wrote its ledger row, not until a person saw the alert.

Reproduce:

```bash
node load-test.js 200 10 50        # 200 requests/s for 10 s with 50 patients
bash ladder.sh 200 400 800 1200    # several rates, each on a fresh database
```

## Tests

CI runs `npm test` and `npm run test:db` on every push, on Node 22 and 24.

```bash
npm test                       # unit tests, no services needed
docker compose up -d --wait    # disposable Postgres on port 5433 (test database only)
npm run test:db                # database tests
```

`test:db` **wipes** its database and rebuilds it from `schema.sql` (twice, to prove it is re-runnable). It refuses to run against any host except `localhost`.

## API

| Endpoint | Purpose |
|---|---|
| `GET /` | Health check |
| `GET /patients`, `GET /patients/:id` | List / fetch patients |
| `POST /patients` | Create a patient (`name`, `bed_no`, `ward_no`) |
| `POST /vital-readings` | Submit a reading (`patient_id`, `vital_type`, `value`); `value` must be a JSON number |
| `GET /alerts` | All alerts |
| `GET /alerts/active` | Active alerts with patient name, ward, bed and latest value |
| `PATCH /alerts/:id/resolve` | Resolve an active alert |

There is **no authentication**.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | none (required) | PostgreSQL connection string |
| `PORT` | `3000` | API port |
| `RABBITMQ_URL` | `amqp://localhost` | RabbitMQ address |
| `WS_PORT` | `8080` | WebSocket server port |

## Run without Docker

Requirements: Node.js 22 or newer, a PostgreSQL database, and RabbitMQ.

```bash
npm install
cp .env.example .env     # then fill in DATABASE_URL (never commit .env)
```

Run `schema.sql` in your database (it is safe to run twice), start RabbitMQ (`docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management`), add test data like `seed.sql` does, then use two terminals: `npm start` and `npm run consumer`.

## Known limitations

- No authentication or authorization; anyone can read alerts and open the dashboard.
- No acknowledgement or escalation: an alert stays active until someone resolves it.
- One API process is the throughput limit (about 400 readings/s by the rules above); running several would need `FOR UPDATE SKIP LOCKED` in the outbox loop to avoid publishing a note twice.
- The outbox table is never cleaned up and its poll has no partial index.
- "Is this alert new?" is inferred from `created_at = last_seen_at`, which is fragile under extreme timing.
- The consumer notifies first and records second, so a crash between the two can notify a nurse twice.
- The consumer does not retry transient database errors and does not wait for a broker confirm when it sends to the retry queue.
- Only `POST /vital-readings` validates its input.
- The dashboard hard-codes WebSocket port 8080 and shows every active alert to every viewer.
- No rate limiting, structured logging or health checks beyond `GET /`.
- The HTTP route itself is not covered by automated tests; the database rule behind it is.
