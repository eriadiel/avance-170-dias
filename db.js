const { Pool } = require('pg');
if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000,
});
const query = (text, params) => pool.query(text, params);
module.exports = { query, pool };
