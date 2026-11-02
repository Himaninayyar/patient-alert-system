const pool = require("./db");
const { getChannel } = require("./queue");

const BATCH_SIZE = 100;

async function publishPending() {
  const channel = getChannel();
  if (!channel) return 0;

  const { rows } = await pool.query(
    "SELECT id, payload FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT $1",
    [BATCH_SIZE]
  );

  if (rows.length === 0) return 0;

  for (const row of rows) {
    channel.sendToQueue(
      "alert-dispatch",
      Buffer.from(JSON.stringify(row.payload)),
      { persistent: true }
    );
  }

  await channel.waitForConfirms();

  await pool.query(
    "UPDATE outbox SET published_at = now() WHERE id = ANY($1::uuid[])",
    [rows.map((row) => row.id)]
  );

  console.log(`Outbox published ${rows.length} alert(s)`);
  return rows.length;
}

function startOutboxPublisher() {
  let stopped = false;
  let timer = null;

  async function loop() {
    let published = 0;

    try {
      published = await publishPending();
    } catch (err) {
      console.error("Outbox publisher error:", err.message);
    }

    if (stopped) return;

    timer = setTimeout(
      loop,
      published >= BATCH_SIZE ? 0 : 500
    );
  }

  loop();

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

module.exports = { startOutboxPublisher };