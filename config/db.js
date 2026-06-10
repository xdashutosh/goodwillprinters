const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  // Recycle idle connections before Neon's pooler drops them (avoids ETIMEDOUT churn)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
});

// Pooled/serverless Postgres (Neon) drops idle connections routinely. That surfaces
// here as an idle-client error — log it and let the pool recover on the next query
// instead of crashing the whole server.
pool.on('error', (err) => {
  console.error('Postgres idle client error (recovering):', err.message);
});

module.exports = pool;
