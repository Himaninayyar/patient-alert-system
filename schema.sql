CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enums: no IF NOT EXISTS exists for types, so we catch the "already exists" error
DO $$ BEGIN
  CREATE TYPE vital_type_enum AS ENUM ('heart_rate', 'spo2', 'blood_pressure', 'temperature');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE alert_status_enum AS ENUM ('active', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  bed_no INT,
  ward_no INT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ward_staff_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_no INT NOT NULL,
  staff_id UUID NOT NULL REFERENCES staff(id),
  shift_start TIMESTAMPTZ,
  shift_end TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS vital_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  vital_type vital_type_enum NOT NULL,
  value NUMERIC NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  vital_type vital_type_enum NOT NULL,
  status alert_status_enum NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only ONE active alert per (patient, vital). The alert upsert depends on this.
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_alert
  ON alerts (patient_id, vital_type)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS alert_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  staff_id UUID NOT NULL REFERENCES staff(id),
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alert_id, staff_id)
);


CREATE TABLE IF NOT EXISTS outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL ,
  published_at TIMESTAMPTZ 
);