const amqp = require("amqplib");

let channel = null;

async function connectQueue() {
  const connection = await amqp.connect("amqp://localhost");
  channel = await connection.createChannel();
  await channel.assertQueue("alert-dispatch",{durable:true});
  console.log("Connected to RabbitMQ");
}

function getChannel() {
  return channel;
}

module.exports = { connectQueue, getChannel };