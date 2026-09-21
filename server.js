const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { query, initDb, pool } = require('./db');
const course = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'data/course.json.gz'))).toString('utf8'));

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('Falta SESSION_SECRET en producción.');
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'solo-para-desarrollo-cambia-esto',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 8,
  },
}));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'No autenticado' });
  next();
}

function role(requiredRole) {
  return (req, res, next) => {
    if (req.session.user?.role !== requiredRole) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    next();
  };
}

app.post('/api/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const { rows } = await query('SELECT id,name,email,password_hash,role FROM users WHERE email=$1', [email]);
    const u = rows[0];
    if (!u || !bcrypt.compareSync(password, u.password_hash)) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }
    req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
    res.json({ user: req.session.user });
  } catch (err) { next(err); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));
app.get('/api/course', auth, (req, res) => res.json(course));

app.get('/api/progress', auth, async (req, res, next) => {
  try {
    let studentId = req.session.user.id;
    if (req.session.user.role === 'tutor' && req.query.studentId) studentId = Number(req.query.studentId);
    const { rows } = await query(`
      SELECT day,completed,completed_at,student_note,tutor_status,tutor_note,verified_at
      FROM progress WHERE student_id=$1 ORDER BY day
    `, [studentId]);
    res.json(rows);
  } catch (err) { next(err); }
});

app.post('/api/progress', auth, role('student'), async (req, res, next) => {
  try {
    const day = Number(req.body.day);
    const completed = !!req.body.completed;
    const note = String(req.body.note || '').slice(0, 2000);
    if (day < 1 || day > 170) return res.status(400).json({ error: 'Día inválido' });

    await query(`
      INSERT INTO progress(student_id,day,completed,completed_at,student_note,tutor_status,tutor_note,verified_at)
      VALUES ($1,$2,$3,$4,$5,'pending',NULL,NULL)
      ON CONFLICT(student_id,day) DO UPDATE SET
        completed=EXCLUDED.completed,
        completed_at=EXCLUDED.completed_at,
        student_note=EXCLUDED.student_note,
        tutor_status='pending',
        tutor_note=NULL,
        verified_at=NULL
    `, [req.session.user.id, day, completed, completed ? new Date() : null, note]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get('/api/students', auth, role('tutor'), async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT u.id,u.name,u.email,
        COALESCE(SUM(CASE WHEN p.completed THEN 1 ELSE 0 END),0)::int AS completed,
        COALESCE(SUM(CASE WHEN p.completed AND p.tutor_status='verified' THEN 1 ELSE 0 END),0)::int AS verified,
        COALESCE(SUM(CASE WHEN p.completed AND p.tutor_status='pending' THEN 1 ELSE 0 END),0)::int AS pending
      FROM users u LEFT JOIN progress p ON p.student_id=u.id
      WHERE u.role='student'
      GROUP BY u.id ORDER BY u.name
    `);
    res.json(rows);
  } catch (err) { next(err); }
});

app.post('/api/verify', auth, role('tutor'), async (req, res, next) => {
  try {
    const studentId = Number(req.body.studentId);
    const day = Number(req.body.day);
    const status = String(req.body.status || 'verified');
    const note = String(req.body.note || '').slice(0, 2000);
    if (!['verified', 'returned'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });
    if (day < 1 || day > 170) return res.status(400).json({ error: 'Día inválido' });

    await query(`
      INSERT INTO progress(student_id,day,completed,tutor_status,tutor_note,verified_at)
      VALUES ($1,$2,TRUE,$3,$4,$5)
      ON CONFLICT(student_id,day) DO UPDATE SET
        tutor_status=EXCLUDED.tutor_status,
        tutor_note=EXCLUDED.tutor_note,
        verified_at=EXCLUDED.verified_at
    `, [studentId, day, status, note, new Date()]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/*splat', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const port = Number(process.env.PORT || 3000);

initDb()
  .then(() => {
    app.listen(port, '0.0.0.0', () => console.log(`Sistema listo en puerto ${port}`));
  })
  .catch((err) => {
    console.error('No se pudo inicializar la base de datos:', err);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
