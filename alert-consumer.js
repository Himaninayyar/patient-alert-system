const amqp = require("amqplib");
const pool = require("./db");
const { WebSocketServer, WebSocket } = require("ws");
const { declareTopology } = require("./queue");
const wss = new WebSocketServer({ port: 8080 });

function broadcast(data) {
  const text = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  }
}

const MAX_TRIES = 3;

async function startConsumer() {
  const connection = await amqp.connect("amqp://localhost");
  const channel = await connection.createChannel();

  await declareTopology(channel);

  console.log("Alert consumer waiting for messages...");

  channel.consume("alert-dispatch", async (msg) => {
    if (msg === null) return;
try {
  const alert = JSON.parse(msg.content.toString());

  const headers = msg.properties.headers || {};
  const triesSoFar = headers["x-attempts"] || 0;
  const thisTry = triesSoFar + 1;

  // Question 1 and 2 together: who is on duty, and were they already told?
  const result = await pool.query(
    `SELECT staff.id, staff.name, staff.role,
            EXISTS (
              SELECT 1 FROM alert_dispatches d
              WHERE d.alert_id = alerts.id AND d.staff_id = staff.id
            ) AS already_notified
     FROM alerts
     JOIN patients ON alerts.patient_id = patients.id
     JOIN ward_staff_assignments ON patients.ward_no = ward_staff_assignments.ward_no
     JOIN staff ON ward_staff_assignments.staff_id = staff.id
     WHERE alerts.id = $1
       AND now() BETWEEN ward_staff_assignments.shift_start
                     AND ward_staff_assignments.shift_end`,
    [alert.alertId]
  );

  // Nobody on duty at all: retry logic, same as before
  if (result.rows.length === 0) {
    console.log(`Nobody on duty (try ${thisTry} of ${MAX_TRIES})`);

    if (thisTry >= MAX_TRIES) {
      console.log("Giving up, moving to problem tray");
      channel.nack(msg, false, false);
    } else {
      channel.sendToQueue("alert-dispatch-retry", msg.content, {
        persistent: true,
        headers: { "x-attempts": thisTry },
      });
      channel.ack(msg);
    }
    return;
  }

  // Tell each person who hasn't been told yet
  for (const person of result.rows) {
    if (person.already_notified) {
      console.log(`Already notified ${person.name}, skipping`);
      continue;
    }

    // 1) tell first
    console.log(`Notifying ${person.name} (${person.role}): ${alert.vital_type} = ${alert.value}`);
   
   
    broadcast({
  staff: person.name,
  role: person.role,
  vital_type: alert.vital_type,
  value: alert.value,
});


    // 2) then write it in the notebook
    await pool.query(
      `INSERT INTO alert_dispatches (alert_id, staff_id)
       VALUES ($1, $2)
       ON CONFLICT (alert_id, staff_id) DO NOTHING`,
      [alert.alertId, person.id]
    );
  }

  channel.ack(msg);
} catch (err) {
      console.error("Failed to process alert:", err.message);
      channel.nack(msg, false, false);
    }
  });
}

startConsumer();