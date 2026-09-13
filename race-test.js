async function testRace() {
  const payload = {
    patient_id: "acfa99f0-d0e7-4ab1-95d4-5976589c8f5b",
    vital_type: "heart_rate",
    value: 125,
  };

  const request1 = fetch("http://localhost:3000/vital-readings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const request2 = fetch("http://localhost:3000/vital-readings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  await Promise.all([request1, request2]);
  console.log("Both requests sent!");
}

testRace();