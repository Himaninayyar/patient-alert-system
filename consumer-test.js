const amqp = require("amqplib");

async function receiveMessages() {
  const connection = await amqp.connect("amqp://localhost");
  const channel = await connection.createChannel();

  const queueName = "alert-dispatch";
  // await channel.assertQueue(queueName);
await channel.assertQueue("alert-dispatch", {
  durable: true,
  deadLetterExchange: "alert-dlx",
});

  console.log("Waiting for messages...");

  // channel.consume(queueName, (msg) => {
  //   if (msg !== null) {
  //     console.log("Received:", msg.content.toString());
  //     // process.exit(1);//a crash before ack 
  //     channel.ack(msg);
  //   }
  // });
//   channel.consume("alert-dispatch", (msg) => {
//   if (msg !== null) {
//     console.log("attempt, redelivered =", msg.fields.redelivered);
//     channel.nack(msg, false, true); // reject AND requeue = simulated failure
//   }
// });
channel.consume("alert-dispatch", (msg) => {
  if (msg !== null) {
    console.log("Giving up on:", msg.content.toString());
    channel.nack(msg, false, false); // reject, do NOT put back
  }
});
}

receiveMessages();