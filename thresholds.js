const THRESHOLDS = {
  heart_rate: { direction: "above", limit: 120 },
  spo2: { direction: "below", limit: 92 },
  temperature: { direction: "above", limit: 38 },
};

function isDangerous(vital_type, value) {
  const rule = THRESHOLDS[vital_type];

  // no rule for this vital (for example blood_pressure): never dangerous
  if (!rule) {
    return false;
  }

  if (rule.direction === "above") {
    return value > rule.limit;
  }

  return value < rule.limit;
}

module.exports = { isDangerous };