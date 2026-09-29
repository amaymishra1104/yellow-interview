const dotenv = require('dotenv');
dotenv.config();

const app = require('./app');
const { checkDbConnection, closePool } = require('./config/db');

const PORT = process.env.PORT || 3000;

let server;

async function startServer() {
  try {
    console.log('⏳ Checking database connection...');
    const dbStatus = await checkDbConnection();
    if (!dbStatus.connected) {
      console.warn(`⚠️ Warning: Database not reachable at startup (${dbStatus.error}). Continuing to start server...`);
    } else {
      console.log(`✓ Database connected successfully (DB Time: ${dbStatus.db_time})`);
    }

    server = app.listen(PORT, () => {
      console.log(`🚀 Coupon Redemption Service running on port ${PORT} [PID: ${process.pid}]`);
      console.log(`👉 Healthcheck: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown handling
async function shutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  if (server) {
    server.close(async () => {
      console.log('✓ HTTP server closed.');
      await closePool();
      console.log('✓ Database connection pool closed.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
