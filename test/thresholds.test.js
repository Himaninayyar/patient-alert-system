const test = require("node:test");
const assert = require("node:assert");
const { isDangerous } = require("../thresholds");

test("heart_rate: dangerous only above 120", () => {
  assert.strictEqual(isDangerous("heart_rate", 125), true);
  assert.strictEqual(isDangerous("heart_rate", 121), true);
  assert.strictEqual(isDangerous("heart_rate", 120), false); // exactly 120 is NOT dangerous
  assert.strictEqual(isDangerous("heart_rate", 60), false);
});

test("spo2: dangerous only below 92", () => {
  assert.strictEqual(isDangerous("spo2", 85), true);
  assert.strictEqual(isDangerous("spo2", 91), true);
  assert.strictEqual(isDangerous("spo2", 92), false); // exactly 92 is NOT dangerous
  assert.strictEqual(isDangerous("spo2", 97), false);
});

test("temperature: dangerous only above 38", () => {
  assert.strictEqual(isDangerous("temperature", 39), true);
  assert.strictEqual(isDangerous("temperature", 38), false);
  assert.strictEqual(isDangerous("temperature", 37), false);
});

test("vitals with no rule are never dangerous", () => {
  assert.strictEqual(isDangerous("blood_pressure", 200), false);
  assert.strictEqual(isDangerous("pulse", 999), false);
});