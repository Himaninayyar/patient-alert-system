const amqp = require("amqplib");

let channel = null;

async function declareTopology(ch) {
  // 1) problem tray: exchange + queue + connection between them
  await ch.assertExchange("alert-dlx", "fanout", { durable: true });
  await ch.assertQueue("alert-dispatch-dlq", { durable: true });
  await ch.bindQueue("alert-dispatch-dlq", "alert-dlx", "");

  // 2) main queue (this was the missing piece)
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
  const connection = await amqp.connect("amqp://localhost");
  channel = await connection.createChannel();

  await declareTopology(channel);

  console.log("Connected to RabbitMQ");
}

function getChannel() {
  return channel;
}

module.exports = { connectQueue, getChannel, declareTopology };