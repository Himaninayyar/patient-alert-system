-- Demo data for the Docker stack (fictional). Runs once, when the database is first created.
INSERT INTO patients (id, name, bed_no, ward_no)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Patient', 1, 3);

WITH new_staff AS (
  INSERT INTO staff (name, role) VALUES ('Nurse Priya', 'nurse') RETURNING id
)
INSERT INTO ward_staff_assignments (ward_no, staff_id, shift_start, shift_end)
SELECT 3, id, now() - interval '1 hour', now() + interval '30 days' FROM new_staff;