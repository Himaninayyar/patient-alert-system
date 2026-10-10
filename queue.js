const amqp = require("amqplib");

let channel = null;

async function connectQueue() {
  const connection = await amqp.connect("amqp://localhost");
  channel = await connection.createChannel();

  // Part 1: build the problem tray first
  await channel.assertExchange("alert-dlx", "fanout", { durable: true });
  await channel.assertQueue("alert-dispatch-dlq", { durable: true });
  await channel.bindQueue("alert-dispatch-dlq", "alert-dlx", "");

  // Part 2: the main queue, pointing at the tray's door
  await channel.assertQueue("alert-dispatch", {
    durable: true,
    deadLetterExchange: "alert-dlx",
  });

  console.log("Connected to RabbitMQ");
}

function getChannel() {
  return channel;
}

module.exports = { connectQueue, getChannel };