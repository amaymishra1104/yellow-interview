const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'rootpassword',
      database: process.env.DB_NAME || 'coupon_db',
      waitForConnections: true,
      connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '50', 10),
      queueLimit: 0,
      multipleStatements: true,
      timezone: 'Z', // UTC handling
      dateStrings: true
    });
  }
  return pool;
}

async function checkDbConnection() {
  try {
    const currentPool = getPool();
    const [rows] = await currentPool.query('SELECT 1 AS alive, UTC_TIMESTAMP() AS db_time');
    return {
      connected: true,
      db_time: rows[0].db_time
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message
    };
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  checkDbConnection,
  closePool
};
