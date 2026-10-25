const amqp = require("amqplib");

let channel = null;

async function declareTopology(ch) {
  // 1) problem tray: exchange + queue + connection between them
  await ch.assertExchange("alert-dlx", "fanout", { durable: true });
  await ch.assertQueue("alert-dispatch-dlq", { durable: true });
  await ch.bindQueue("alert-dispatch-dlq", "alert-dlx", "");

  // 2) main queue
  await ch.assertQueue("alert-dispatch", {
    durable: true,
    deadLetterExchange: "alert-dlx",
  });

  // 3) retry queue: waits 10 s, then sends messages back to the main queue
  await ch.assertQueue("alert-dispatch-retry", {
    durable: true,
    messageTtl: 10000,
    deadLetterExchange: "",
    deadLetterRoutingKey: "alert-dispatch",
  });
}

async function connectQueue() {
  const connection = await amqp.connect("amqp://localhost", {
    recovery: {
      initialDelay: 500,      // first retry after 0.5 s
      maxDelay: 10000,        // never wait more than 10 s
      waitForConnect: false,  // don't block startup if RabbitMQ is down
      async setup(model) {
        // runs after EVERY successful (re)connect: new channel + topology
        const ch = await model.createChannel();
        await declareTopology(ch);
        channel = ch;
      },
    },
  });

  connection.on("connect", () => console.log("Connected to RabbitMQ"));
  connection.on("disconnect", (err) => {
    channel = null;           // nothing can be published until we reconnect
    console.warn("RabbitMQ disconnected:", err ? err.message : "unknown reason");
  });
  connection.on("reconnect-scheduled", ({ attempt, delay }) => {
    console.log(`RabbitMQ unavailable, retry ${attempt} in ${delay} ms`);
  });
  connection.on("error", (err) => {
    console.error("RabbitMQ connection error:", err.message);  // without this, Node crashes
  });
}

function getChannel() {
  return channel;
}

module.exports = { connectQueue, getChannel, declareTopology };