#!/usr/bin/env bash
# Runs the load test at several rates. EVERY rate starts from a fresh database, so the
# numbers of one run never mix with another.
# Usage:  bash ladder.sh 200 400 800 1200

RUN_SECONDS=10    # how long each run sends readings
DRAIN_WAIT=25     # seconds to let queued alerts finish before measuring
PATIENTS=50

QUERY="SELECT (SELECT count(*) FROM vital_readings) AS readings,
  (SELECT count(*) FROM alerts) AS alerts,
  (SELECT count(*) FROM outbox WHERE published_at IS NULL) AS unsent,
  count(d.id) AS delivered,
  round(extract(epoch FROM percentile_cont(0.5)  WITHIN GROUP (ORDER BY d.delivered_at - a.created_at))::numeric,2) AS p50_s,
  round(extract(epoch FROM percentile_cont(0.95) WITHIN GROUP (ORDER BY d.delivered_at - a.created_at))::numeric,2) AS p95_s,
  round(extract(epoch FROM max(d.delivered_at - a.created_at))::numeric,2) AS max_s
FROM alerts a LEFT JOIN alert_dispatches d ON d.alert_id = a.id;"

for RATE in "$@"; do
  echo
  echo "################ $RATE requests/s for $RUN_SECONDS s ################"
  docker compose --profile app down -v > /dev/null 2>&1
  docker compose --profile app up -d --wait > /dev/null 2>&1 || { echo "stack did not start"; exit 1; }
  sleep 3
  node load-test.js "$RATE" "$RUN_SECONDS" "$PATIENTS"
  echo "waiting $DRAIN_WAIT s for queued alerts to be delivered..."
  sleep "$DRAIN_WAIT"
  echo "--- alert delivery (database)"
  docker compose --profile app exec -T db psql -U app -d alerts -c "$QUERY"
done