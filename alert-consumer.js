const amqp = require("amqplib");
const pool = require("./db");

const MAX_TRIES = 3;

async function startConsumer() {
  const connection = await amqp.connect("amqp://localhost");
  const channel = await connection.createChannel();

  await channel.assertQueue("alert-dispatch", {
    durable: true,
    deadLetterExchange: "alert-dlx",
  });

  console.log("Alert consumer waiting for messages...");

  channel.consume("alert-dispatch", async (msg) => {
    if (msg === null) return;

    try {
      const alert = JSON.parse(msg.content.toString());

      // how many tries so far? (no label yet = 0)
      const headers = msg.properties.headers || {};
      const triesSoFar = headers["x-attempts"] || 0;
      const thisTry = triesSoFar + 1;

      const result = await pool.query(
        `SELECT staff.name, staff.role
         FROM alerts
         JOIN patients ON alerts.patient_id = patients.id
         JOIN ward_staff_assignments ON patients.ward_no = ward_staff_assignments.ward_no
         JOIN staff ON ward_staff_assignments.staff_id = staff.id
         WHERE alerts.id = $1
           AND now() BETWEEN ward_staff_assignments.shift_start
                         AND ward_staff_assignments.shift_end`,
        [alert.alertId]
      );

      if (result.rows.length === 0) {
        console.log(`Nobody on duty (try ${thisTry} of ${MAX_TRIES})`);

        if (thisTry >= MAX_TRIES) {
          console.log("Giving up, moving to problem tray");
          channel.nack(msg, false, false); // goes to alert-dispatch-dlq
        } else {
          // put a copy in the waiting room with the new count
          channel.sendToQueue("alert-dispatch-retry", msg.content, {
            persistent: true,
            headers: { "x-attempts": thisTry },
          });
          channel.ack(msg); // remove the original
        }
        return;
      }

      for (const person of result.rows) {
        console.log(`Notifying ${person.name} (${person.role}): ${alert.vital_type} = ${alert.value}`);
      }

      channel.ack(msg);
    } catch (err) {
      console.error("Failed to process alert:", err.message);
      channel.nack(msg, false, false);
    }
  });
}

startConsumer();