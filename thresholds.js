const THRESHOLDS = {
  heart_rate: { direction: "above", limit: 120 },
  spo2: { direction: "below", limit: 92 },
  temperature: { direction: "above", limit: 38 },
};

function isDangerous(vital_type, value) {
  const rule = THRESHOLDS[vital_type];

  // blank 1: if there is no rule for this vital, return false
if(!rule){
    return false;
}


  // blank 2: if rule.direction is "above", return true when value is bigger than rule.limit

  if(rule.direction=="above"){
    return value>rule.limit;
  }
  // blank 3: otherwise return true when value is smaller than rule.limit
    return value<rule.limit;

}


module.exports = { isDangerous };