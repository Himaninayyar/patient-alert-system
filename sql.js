// SQL shared by the API and the tests, so the tests exercise the REAL statement.
const UPSERT_ALERT = `INSERT INTO alerts (patient_id, vital_type)
  VALUES ($1, $2)
  ON CONFLICT (patient_id, vital_type) WHERE status = 'active'
  DO UPDATE SET last_seen_at = now()
  RETURNING *`;

module.exports = { UPSERT_ALERT };