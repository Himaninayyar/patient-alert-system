const amqp = require("amqplib");
const pool = require("./db");

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