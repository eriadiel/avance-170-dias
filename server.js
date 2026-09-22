const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const { query, pool } = require('./db');
const { CLASS_IDS, validLesson, summarize } = require('./progress');
const curriculum = JSON.parse(require('zlib').gunzipSync(require('fs').readFileSync(path.join(__dirname,'data/curriculum.json.gz'))).toString('utf8'));
const app = express();
const production = process.env.NODE_ENV === 'production';
if (production && !process.env.SESSION_SECRET) throw new Error('Falta SESSION_SECRET.');
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({limit:'32kb'}));
app.use('/api', (req,res,next) => {
  res.set('Cache-Control','no-store');
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
    const origin=req.get('origin');
    if (req.get('sec-fetch-site') === 'cross-site' || (origin && origin !== `${req.protocol}://${req.get('host')}`)) return res.status(403).json({error:'Origen no permitido'});
  }
  next();
});
app.use(session({
  store: new PgSession({pool,tableName:'user_sessions',createTableIfMissing:false}),
  secret:process.env.SESSION_SECRET || 'development-only',resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:'lax',secure:production,maxAge:8*60*60*1000},
}));
const auth=(req,res,next)=>req.session.user ? next() : res.status(401).json({error:'No autenticado'});
const role=r=>(req,res,next)=>req.session.user.role===r ? next() : res.status(403).json({error:'Permisos insuficientes'});
const positiveInt=n=>Number.isInteger(n)&&n>0;
async function studentFor(req,res) {
  const own=req.session.user.id;
  if (req.session.user.role==='student') {
    if (req.query.studentId && Number(req.query.studentId)!==own) {res.status(403).json({error:'Permisos insuficientes'});return null;}
    return own;
  }
  const id=Number(req.query.studentId);
  if (!positiveInt(id)) {res.status(400).json({error:'Selecciona un estudiante'});return null;}
  const {rows}=await query("SELECT id FROM users WHERE id=$1 AND role='student'",[id]);
  if (!rows.length) {res.status(404).json({error:'Estudiante no encontrado'});return null;}
  return id;
}
app.post('/api/login',async(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
  if(email.length>254 || password.length>256) return res.status(400).json({error:'Credenciales inválidas'});
  const {rows}=await query('SELECT id,name,email,password_hash,role FROM users WHERE email=$1',[email]);
  const u=rows[0];
  if(!u || !(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:'Correo o contraseña incorrectos'});
  await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
  req.session.user={id:u.id,name:u.name,email:u.email,role:u.role};
  await new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
  res.json({user:req.session.user});
});
app.post('/api/logout',async(req,res)=>{
  await new Promise((resolve,reject)=>req.session.destroy(e=>e?reject(e):resolve()));
  res.clearCookie('connect.sid',{httpOnly:true,sameSite:'lax',secure:production});res.json({ok:true});
});
app.get('/api/me',(req,res)=>res.json({user:req.session.user||null}));
app.get('/api/course',auth,(req,res)=>res.json({totalDays:170,classes:curriculum.classes.map(({id,name,source})=>({id,name,source}))}));
app.get('/api/course/:classId',auth,(req,res)=>{
  const subject=curriculum.classes.find(c=>c.id===req.params.classId);
  if(!subject) return res.status(404).json({error:'Clase no encontrada'});res.json(subject);
});
app.get('/api/progress',auth,async(req,res)=>{
  const id=await studentFor(req,res); if(id===null)return;
  const {rows}=await query('SELECT class_id,day,completed,completed_at,student_note,tutor_status,tutor_note,verified_at FROM class_progress WHERE student_id=$1 ORDER BY day,class_id',[id]);
  res.json({progress:rows,summary:summarize(rows)});
});
app.post('/api/progress',auth,role('student'),async(req,res)=>{
  const {classId,day,completed}=req.body;
  if(!validLesson(classId,day)||typeof completed!=='boolean')return res.status(400).json({error:'Clase, día o estado inválido'});
  const note=String(req.body.note||'').slice(0,2000);
  await query(`INSERT INTO class_progress(student_id,class_id,day,completed,completed_at,student_note)
    VALUES($1,$2,$3,$4,CASE WHEN $4 THEN now() ELSE NULL END,$5)
    ON CONFLICT(student_id,class_id,day) DO UPDATE SET
      completed=EXCLUDED.completed,
      completed_at=CASE WHEN EXCLUDED.completed THEN COALESCE(class_progress.completed_at,now()) ELSE NULL END,
      student_note=EXCLUDED.student_note,
      tutor_status=CASE WHEN class_progress.completed IS DISTINCT FROM EXCLUDED.completed OR class_progress.student_note IS DISTINCT FROM EXCLUDED.student_note THEN 'pending' ELSE class_progress.tutor_status END,
      tutor_note=CASE WHEN class_progress.completed IS DISTINCT FROM EXCLUDED.completed OR class_progress.student_note IS DISTINCT FROM EXCLUDED.student_note THEN NULL ELSE class_progress.tutor_note END,
      verified_at=CASE WHEN class_progress.completed IS DISTINCT FROM EXCLUDED.completed OR class_progress.student_note IS DISTINCT FROM EXCLUDED.student_note THEN NULL ELSE class_progress.verified_at END`,
    [req.session.user.id,classId,day,completed,note]);res.json({ok:true});
});
app.get('/api/students',auth,role('tutor'),async(req,res)=>{
  const {rows}=await query("SELECT id,name,email FROM users WHERE role='student' ORDER BY name");res.json(rows);
});
app.post('/api/verify',auth,role('tutor'),async(req,res)=>{
  const {studentId,classId,day,status}=req.body;
  if(!positiveInt(studentId)||!validLesson(classId,day)||!['verified','returned'].includes(status))return res.status(400).json({error:'Estudiante, clase, día o estado inválido'});
  const {rowCount}=await query(`UPDATE class_progress p SET tutor_status=$4,tutor_note=$5,
    verified_at=CASE WHEN $4='verified' THEN now() ELSE NULL END
    WHERE student_id=$1 AND class_id=$2 AND day=$3 AND completed=true
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.student_id AND u.role='student')`,
    [studentId,classId,day,status,String(req.body.note||'').slice(0,2000)]);
  if(!rowCount)return res.status(409).json({error:'El estudiante debe completar esta clase y día antes de verificarla'});res.json({ok:true});
});
app.get('/health',async(req,res)=>{await query('SELECT class_id FROM class_progress LIMIT 0');res.json({ok:true,version:2,classes:CLASS_IDS.length});});
app.use('/api',(req,res)=>res.status(404).json({error:'Ruta no encontrada'}));
app.use(express.static(path.join(__dirname,'public'),{maxAge:0}));
app.get('/*splat',(req,res)=>res.sendFile(path.join(__dirname,'public/index.html')));
app.use((err,req,res,next)=>{
  console.error('Request failed',{code:err.code||'INTERNAL',path:req.path});
  res.status(err.type==='entity.parse.failed'?400:500).json({error:err.type==='entity.parse.failed'?'JSON inválido':'Error interno del servidor'});
});
module.exports=app;
if(require.main===module)app.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('Aplicación lista'));
