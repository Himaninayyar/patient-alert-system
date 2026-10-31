const pool = require("./db");
const { getChannel } = require("./queue");

async function publishPending() {
  const channel = getChannel();
  if (!channel) return;   // broker not ready yet, try again next round

  const { rows } = await pool.query(
    "SELECT id, payload FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 10"
  );

  for (const row of rows) {
    await channel.waitForConfirms();
    channel.sendToQueue(
      "alert-dispatch",
      Buffer.from(JSON.stringify(row.payload)),
      { persistent: true }
    );
    await pool.query("UPDATE outbox SET published_at = now() WHERE id = $1", [row.id]);
    console.log("Outbox published alert:", row.payload.alertId);
  }
}

function startOutboxPublisher() {
  let running = false;
  const timer=setInterval(async () => {
    if (running) return;          // don't start a round while the last one is still going
    running = true;
    try {
      await publishPending();
    } catch (err) {
      console.error("Outbox publisher error:", err.message);
    } finally {
      running = false;
    }
  }, 2000);
  return ()=>clearInterval(timer);
}

module.exports = { startOutboxPublisher };