const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL. Configura la variable de entorno antes de iniciar la aplicación.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function query(text, params) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','tutor')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS progress (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 170),
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at TIMESTAMPTZ,
      student_note TEXT,
      tutor_status TEXT NOT NULL DEFAULT 'pending' CHECK(tutor_status IN ('pending','verified','returned')),
      tutor_note TEXT,
      verified_at TIMESTAMPTZ,
      UNIQUE(student_id, day)
    );

    CREATE INDEX IF NOT EXISTS idx_progress_student_day ON progress(student_id, day);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  `);

  const tutorHash = bcrypt.hashSync('tutor123', 10);
  const studentHash = bcrypt.hashSync('student123', 10);
  await query(`
    INSERT INTO users(name,email,password_hash,role)
    VALUES ($1,$2,$3,$4),($5,$6,$7,$8)
    ON CONFLICT(email) DO NOTHING
  `, [
    'Tutor Demo', 'tutor@example.com', tutorHash, 'tutor',
    'Estudiante Demo', 'student@example.com', studentHash, 'student'
  ]);
}

module.exports = { query, initDb, pool };