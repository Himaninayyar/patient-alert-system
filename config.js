require("dotenv").config({ quiet: true });

module.exports = {
  port: Number(process.env.PORT) || 3000,
  rabbitmqUrl: process.env.RABBITMQ_URL || "amqp://localhost",
  wsPort: Number(process.env.WS_PORT) || 8080,
};