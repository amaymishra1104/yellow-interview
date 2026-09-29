const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function runMigration() {
  console.log('🔄 Starting database migration...');

  const host = process.env.DB_HOST || '127.0.0.1';
  const port = parseInt(process.env.DB_PORT || '3306', 10);
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || 'rootpassword';
  const database = process.env.DB_NAME || 'coupon_db';

  let connection;
  try {
    // 1. Initial connection to ensure database exists
    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      multipleStatements: true
    });

    console.log(`Connected to MySQL server at ${host}:${port}`);

    // Create database if not exists
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    console.log(`✓ Database '${database}' verified/created.`);

    await connection.query(`USE \`${database}\`;`);

    // 2. Read schema.sql
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // 3. Execute schema
    await connection.query(schemaSql);
    console.log('✓ Executed schema.sql successfully.');

    // 4. Verify tables
    const [tables] = await connection.query('SHOW TABLES;');
    console.log('✓ Existing tables in database:');
    tables.forEach((row) => {
      console.log(`  - ${Object.values(row)[0]}`);
    });

    console.log('🎉 Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
