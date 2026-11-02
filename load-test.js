// Load generator: sends vital readings at a steady rate and reports what happened.
// Usage:   node load-test.js <requests per second> <seconds> [number of patients]
// Example: node load-test.js 50 30
const { performance } = require("node:perf_hooks");

const TARGET = process.env.TARGET || "http://localhost:3000";
const RATE = Number(process.argv[2]) || 20;
const SECONDS = Number(process.argv[3]) || 10;
const PATIENTS = Number(process.argv[4]) || 50;

// [min, max] for a normal and for a dangerous reading of each vital
const VITALS = {
  heart_rate: {
    safe: [60, 120],
    danger: [121, 180],
  },
  spo2: {
    safe: [92, 99],
    danger: [80, 91],
  },
  temperature: {
    safe: [36, 38],
    danger: [38.1, 41],
  },
  blood_pressure: {
    safe: [100, 130],
    danger: [150, 190], // isDangerous() ignores this vital
  },
};

const VITAL_NAMES = Object.keys(VITALS);
const DANGEROUS_SHARE = 0.2; // 1 reading in 5 is dangerous

function between(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

function randomReading(patientIds) {
  const vital = VITAL_NAMES[Math.floor(Math.random() * VITAL_NAMES.length)];
  const range = Math.random() < DANGEROUS_SHARE ? VITALS[vital].danger : VITALS[vital].safe;
  return {
    patient_id: patientIds[Math.floor(Math.random() * patientIds.length)],
    vital_type: vital,
    value: between(range[0], range[1]),
  };
}

async function createPatients() {
  const ids = [];
  for (let i = 1; i <= PATIENTS; i++) {
    const res = await fetch(`${TARGET}/patients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Load Test ${i}`, bed_no: i, ward_no: 3 }),
    });
    if (res.status !== 201) {
      throw new Error(`Could not create a patient (HTTP ${res.status}). Is the API running at ${TARGET}?`);
    }
    ids.push((await res.json()).id);
  }
  return ids;
}

async function sendOne(body) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${TARGET}/vital-readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    await res.arrayBuffer(); // read the whole answer before stopping the clock
    return { ms: performance.now() - t0, status: String(res.status) };
  } catch (err) {
    return { ms: performance.now() - t0, status: err.name === "TimeoutError" ? "timeout" : "network error" };
  }
}

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return NaN;
  return sortedMs[Math.max(0, Math.ceil(p * sortedMs.length) - 1)];
}

async function main() {
  const total = RATE * SECONDS;
  console.log(`Target ${TARGET}: ${RATE} requests/s for ${SECONDS} s = ${total} requests, ${PATIENTS} patients`);

  const patientIds = await createPatients();
  console.log(`Created ${patientIds.length} patients. Sending...`);

  const results = [];
  const inFlight = new Set();
  let sent = 0;
  const start = performance.now();
  let sendingFinished = 0;

  // Open loop: requests leave on schedule whether or not earlier ones have been answered,
  // so a slow server shows up as slow answers instead of a quietly reduced load.
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      const due = Math.min(total, Math.floor(((performance.now() - start) / 1000) * RATE));
      while (sent < due) {
        sent++;
        const p = sendOne(randomReading(patientIds)).then((r) => results.push(r));
        inFlight.add(p);
        p.finally(() => inFlight.delete(p));
      }
      if (sent >= total) {
        sendingFinished = performance.now();
        clearInterval(timer);
        resolve();
      }
    }, 5);
  });
  await Promise.all(inFlight);
  const end = performance.now();

  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const ok = results.filter((r) => r.status === "201").map((r) => r.ms).sort((a, b) => a - b);
  const sendSeconds = (sendingFinished - start) / 1000;
  const totalSeconds = (end - start) / 1000;

  console.log("\n===== RESULT =====");
  console.log(`Requests sent:        ${sent} in ${sendSeconds.toFixed(1)} s (offered ${(sent / sendSeconds).toFixed(1)}/s)`);
  console.log(`Answers received by:  ${totalSeconds.toFixed(1)} s`);
  console.log("Status codes:        ", JSON.stringify(counts));
  console.log(`Success rate:         ${((ok.length / sent) * 100).toFixed(2)} %  (${ok.length} of ${sent} got 201)`);
  console.log(`Throughput:           ${(ok.length / totalSeconds).toFixed(1)} successful readings/s`);
  console.log(
    `Latency of 201s (ms): p50 ${percentile(ok, 0.5).toFixed(0)} | p95 ${percentile(ok, 0.95).toFixed(0)} | ` +
      `p99 ${percentile(ok, 0.99).toFixed(0)} | max ${ok.length ? ok[ok.length - 1].toFixed(0) : "n/a"}`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});