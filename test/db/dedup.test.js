const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { UPSERT_ALERT } = require("../../sql");

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || "postgres://test:test@localhost:5433/alerts_test";

  const host = new URL(TEST_DB_URL).hostname;

if (host !== "localhost" && host !== "127.0.0.1") {
  throw new Error(`Refusing to run DB tests against a non-local host: ${host}`);
}

describe("alert dedup (needs the local test database)", () => {
  let pool;
  let patientId;

  before(async () => {
  pool = new Pool({ connectionString: TEST_DB_URL, max: 20 });

  const schemaSql = fs.readFileSync(
  path.join(__dirname, "..", "..", "schema.sql"),
  "utf8"
);

await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");

await pool.query(schemaSql);
await pool.query(schemaSql);

const res = await pool.query(
  "INSERT INTO patients (name, ward_no) VALUES ('Race Test', 1) RETURNING id"
);

patientId = res.rows[0].id;

});
after(async () => {
  await pool.end();
});

//test1
it("schema.sql creates the unique_active_alert index", async () => {
  const { rows } = await pool.query(
    "SELECT 1 FROM pg_indexes WHERE tablename = 'alerts' AND indexname = 'unique_active_alert'"
  );

  assert.strictEqual(rows.length, 1);
});

//test2
it("20 simultaneous dangerous readings create exactly ONE active alert", async () => {
  const results = await Promise.all(

    
    Array.from({ length: 20 }, () =>
      pool.query(UPSERT_ALERT, [patientId, "heart_rate"])
    )
  );
  const { rows } = await pool.query(
  `SELECT count(*)::int AS n FROM alerts
   WHERE patient_id = $1 AND vital_type = 'heart_rate' AND status = 'active'`,
  [patientId]
);
assert.strictEqual(rows[0].n, 1);

const ids = new Set(results.map((r) => r.rows[0].id));
assert.strictEqual(ids.size, 1);

});

//test3-resolve the alert
it("after an alert is resolved, the next dangerous reading creates a NEW alert", async () => {
  const first = await pool.query(UPSERT_ALERT, [patientId, "spo2"]);
  await pool.query(
  "UPDATE alerts SET status = 'resolved' WHERE id = $1",
  [first.rows[0].id]
);

const second = await pool.query(UPSERT_ALERT, [patientId, "spo2"]);
assert.notStrictEqual(second.rows[0].id, first.rows[0].id);

const { rows } = await pool.query(
  `SELECT count(*)::int AS total,
          count(*) FILTER (WHERE status = 'active')::int AS active
   FROM alerts WHERE patient_id = $1 AND vital_type = 'spo2'`,
  [patientId]
);

assert.strictEqual(rows[0].total, 2);
assert.strictEqual(rows[0].active, 1);


});



});