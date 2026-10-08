const amqp = require("amqplib");

let channel = null;

async function connectQueue() {
  const connection = await amqp.connect("amqp://localhost");
  channel = await connection.createChannel();
  await channel.assertQueue("alert-dispatch");
  console.log("Connected to RabbitMQ");
}

function getChannel() {
  return channel;
}

module.exports = { connectQueue, getChannel };