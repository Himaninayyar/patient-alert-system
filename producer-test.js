const amqp=require("amqplib");

async function sendMessage() {
    const connection =await amqp.connect("amqp://localhost");
    const channel = await connection.createChannel();

    const queueName="hello-queue";
    await channel.assertQueue(queueName);

    const message="Hello rabbitMQ!";
    channel.sendToQueue(queueName,Buffer.from(message));

    console.log("sent:",message);

    setTimeout(()=>{
        connection.close();
    },500);

}
sendMessage();