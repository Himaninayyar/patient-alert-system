const amqp = require("amqplib");

async function receiveMessages() {
  const connection = await amqp.connect("amqp://localhost");
  const channel = await connection.createChannel();

  const queueName = "alert-dispatch";
  await channel.assertQueue(queueName);

  console.log("Waiting for messages...");

  channel.consume(queueName, (msg) => {
    if (msg !== null) {
      console.log("Received:", msg.content.toString());
      channel.ack(msg);
    }
  });
}

receiveMessages();