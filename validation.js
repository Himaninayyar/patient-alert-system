const VITAL_TYPES = ["heart_rate", "spo2", "blood_pressure", "temperature"];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns an error message (text) if the input is bad, or null if it is fine
function validateVitalReading(body) {
  if (!body || typeof body !== "object") {
    return "Request body must be a JSON object";
  }

  const { patient_id, vital_type, value } = body;

  if (typeof patient_id !== "string" || !UUID_REGEX.test(patient_id)) {
    return "patient_id must be a valid UUID";
  }
  if (!VITAL_TYPES.includes(vital_type)) {
    return `vital_type must be one of: ${VITAL_TYPES.join(", ")}`;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "value must be a number";
  }

  return null;
}

module.exports = { validateVitalReading, VITAL_TYPES };