CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  bed_no INT,
  ward_no INT NOT NULL
);

CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL
);

CREATE TABLE ward_staff_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_no INT NOT NULL,
  staff_id UUID NOT NULL REFERENCES staff(id),
  shift_start TIMESTAMPTZ,
  shift_end TIMESTAMPTZ
);

CREATE TYPE vital_type_enum AS ENUM ('heart_rate', 'spo2', 'blood_pressure', 'temperature');

CREATE TABLE vital_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  vital_type vital_type_enum NOT NULL,
  value NUMERIC NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE alert_status_enum AS ENUM ('active', 'resolved');

CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  vital_type vital_type_enum NOT NULL,
  status alert_status_enum NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  staff_id UUID NOT NULL REFERENCES staff(id),
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alert_id, staff_id)
);


CREATE TABLE alert_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  staff_id UUID NOT NULL REFERENCES staff(id),
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alert_id, staff_id)
);