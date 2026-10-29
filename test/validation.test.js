const test = require("node:test");
const assert = require("node:assert");
const { validateVitalReading } = require("../validation");

const GOOD_ID = "83356465-2c81-44be-b677-511c8b57121a";

test("a good reading passes (returns null)", () => {
  assert.strictEqual(
    validateVitalReading({ patient_id: GOOD_ID, vital_type: "spo2", value: 85 }),
    null
  );
});

test("rejects a missing or non-object body", () => {
  const msg = "Request body must be a JSON object";
  assert.strictEqual(validateVitalReading(undefined), msg);
  assert.strictEqual(validateVitalReading(null), msg);
  assert.strictEqual(validateVitalReading("hello"), msg);
});

test("rejects a bad patient_id", () => {
  const msg = "patient_id must be a valid UUID";
  assert.strictEqual(validateVitalReading({ patient_id: "abc", vital_type: "spo2", value: 85 }), msg);
  assert.strictEqual(validateVitalReading({ vital_type: "spo2", value: 85 }), msg);
  assert.strictEqual(validateVitalReading({ patient_id: 123, vital_type: "spo2", value: 85 }), msg);
});

test("rejects an unknown vital_type", () => {
  const result = validateVitalReading({ patient_id: GOOD_ID, vital_type: "pulse", value: 85 });
  assert.match(result, /^vital_type must be one of:/);
});

test("rejects a value that is not a real number", () => {
  const msg = "value must be a number";
  for (const bad of ["abc", "125", null, undefined, true, NaN, Infinity]) {
    assert.strictEqual(
      validateVitalReading({ patient_id: GOOD_ID, vital_type: "heart_rate", value: bad }),
      msg,
      `value ${String(bad)} should be rejected`
    );
  }
});

test("checks run in order: the first problem is the one reported", () => {
  assert.strictEqual(
    validateVitalReading({ patient_id: "abc", vital_type: "pulse", value: "x" }),
    "patient_id must be a valid UUID"
  );
});