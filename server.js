const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
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
  const email=String(req.body.username||req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
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

async function dailyStudent(id){const {rows}=await query("SELECT id FROM users WHERE id=$1 AND email='emalucia' AND role='student'",[id]);return rows.length>0;}
const subjectsOnly=async(req,res,next)=>{
 const id=req.session.user.role==='student'?req.session.user.id:req.query.studentId;
 if(id&&await dailyStudent(Number(id)))return res.status(403).json({error:'Este estudiante utiliza avance diario, sin materias'});next();
};

app.get('/api/course',auth,async(req,res)=>{
 const id=req.session.user.role==='student'?req.session.user.id:req.query.studentId;
 const daily=id&&await dailyStudent(Number(id));
 res.json({totalDays:170,mode:daily?'daily':'subjects',classes:daily?[]:curriculum.classes.map(({id,name,source})=>({id,name,source}))});
});
app.get('/api/course/:classId',auth,subjectsOnly,(req,res)=>{
  const subject=curriculum.classes.find(c=>c.id===req.params.classId);
  if(!subject) return res.status(404).json({error:'Clase no encontrada'});res.json(subject);
});
app.get('/api/progress',auth,subjectsOnly,async(req,res)=>{
  const id=await studentFor(req,res); if(id===null)return;
  const {rows}=await query('SELECT class_id,day,completed,completed_at,student_note,tutor_status,tutor_note,verified_at FROM class_progress WHERE student_id=$1 ORDER BY day,class_id',[id]);
  res.json({progress:rows,summary:summarize(rows)});
});
app.post('/api/progress',auth,role('student'),subjectsOnly,async(req,res)=>{
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
  const {rows}=await query("SELECT id,name,email FROM users WHERE role='student' ORDER BY CASE WHEN email='eriandres' THEN 0 ELSE 1 END,name");res.json(rows);
});
app.post('/api/verify',auth,role('tutor'),async(req,res)=>{
  const {studentId,classId,day,status}=req.body;
  if(await dailyStudent(studentId))return res.status(403).json({error:'Utiliza la verificación diaria de este estudiante'});
  if(!positiveInt(studentId)||!validLesson(classId,day)||!['verified','returned'].includes(status))return res.status(400).json({error:'Estudiante, clase, día o estado inválido'});
  const {rowCount}=await query(`UPDATE class_progress p SET tutor_status=$4,tutor_note=$5,
    verified_at=CASE WHEN $4='verified' THEN now() ELSE NULL END
    WHERE student_id=$1 AND class_id=$2 AND day=$3 AND completed=true
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.student_id AND u.role='student')`,
    [studentId,classId,day,status,String(req.body.note||'').slice(0,2000)]);
  if(!rowCount)return res.status(409).json({error:'El estudiante debe completar esta clase y día antes de verificarla'});res.json({ok:true});
});


app.get('/api/daily-progress',auth,async(req,res)=>{
 const id=await studentFor(req,res);if(id===null)return;
 if(!await dailyStudent(id))return res.status(403).json({error:'Este estudiante utiliza progreso por materias'});
 const {rows}=await query('SELECT day,completed,tutor_status,completed_at,verified_at FROM daily_progress WHERE student_id=$1 ORDER BY day',[id]);
 res.json({progress:rows});
});
app.post('/api/daily-progress',auth,role('student'),async(req,res)=>{
 if(!await dailyStudent(req.session.user.id))return res.status(403).json({error:'Este estudiante utiliza progreso por materias'});
 const {day,completed}=req.body;
 if(!Number.isInteger(day)||day<1||day>170||typeof completed!=='boolean')return res.status(400).json({error:'Día o estado inválido'});
 await query(`INSERT INTO daily_progress(student_id,day,completed,completed_at) VALUES($1,$2,$3,CASE WHEN $3 THEN now() ELSE NULL END)
 ON CONFLICT(student_id,day) DO UPDATE SET completed=EXCLUDED.completed,
 completed_at=CASE WHEN EXCLUDED.completed THEN COALESCE(daily_progress.completed_at,now()) ELSE NULL END,
 tutor_status=CASE WHEN daily_progress.completed IS DISTINCT FROM EXCLUDED.completed THEN 'pending' ELSE daily_progress.tutor_status END,
 verified_at=CASE WHEN daily_progress.completed IS DISTINCT FROM EXCLUDED.completed THEN NULL ELSE daily_progress.verified_at END`,[req.session.user.id,day,completed]);
 res.json({ok:true});
});
app.post('/api/daily-verify',auth,role('tutor'),async(req,res)=>{
 const {studentId,day,status}=req.body;
 if(!positiveInt(studentId)||!Number.isInteger(day)||day<1||day>170||!['verified','returned'].includes(status))return res.status(400).json({error:'Datos inválidos'});
 if(!await dailyStudent(studentId))return res.status(403).json({error:'Este estudiante utiliza progreso por materias'});
 const {rowCount}=await query("UPDATE daily_progress SET tutor_status=$3,verified_at=CASE WHEN $3='verified' THEN now() ELSE NULL END WHERE student_id=$1 AND day=$2 AND completed=true",[studentId,day,status]);
 if(!rowCount)return res.status(409).json({error:'Primero debe marcar el día como completado'});
 res.json({ok:true});
});

const chatAuth=[auth,async(req,res,next)=>{
  const {rows}=await query("SELECT id FROM users WHERE id=$1 AND role IN ('student','tutor')",[req.session.user.id]);
  if(!rows.length)return res.status(403).json({error:'No tienes acceso al chat'});next();
}];

const IMAGE_BRIDGE='https://efijxswzpaapuqwrardk.supabase.co/functions/v1/chat-images';
const imageIdValid=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
async function imageTicket(id,action){
 const token=randomBytes(32).toString('hex');
 await query('DELETE FROM chat_image_tickets WHERE expires_at<now()');
 await query("INSERT INTO chat_image_tickets(token_hash,image_id,action,expires_at) VALUES($1,$2,$3,now()+interval '2 minutes')",[createHash('sha256').update(token).digest('hex'),id,action]);
 return token;
}
app.post('/api/chat/images',...chatAuth,async(req,res)=>{
 const allowed=await query("SELECT id FROM users WHERE id=$1 AND email='eri' AND role='tutor'",[req.session.user.id]);
 if(!allowed.rows.length)return res.status(403).json({error:'Solo eri puede adjuntar imágenes'});
 const {mime,size}=req.body;
 if(!['image/png','image/jpeg','image/webp'].includes(mime)||!Number.isInteger(size)||size<1||size>5242880)return res.status(400).json({error:'Usa PNG, JPG o WebP de hasta 5 MB'});
 const id=randomUUID();
 const result=await query(`INSERT INTO chat_images(id,author_id,mime,size)
 SELECT $1,$2,$3,$4 WHERE (SELECT count(*) FROM chat_images WHERE author_id=$2 AND created_at>now()-interval '1 hour')<30 RETURNING id`,[id,req.session.user.id,mime,size]);
 if(!result.rows.length)return res.status(429).json({error:'Límite de 30 imágenes por hora. Intenta más tarde.'});
 res.status(201).json({id,url:IMAGE_BRIDGE,token:await imageTicket(id,'upload')});
});
app.get('/api/chat/images/:id',...chatAuth,async(req,res)=>{
 if(!imageIdValid(req.params.id))return res.status(404).json({error:'Imagen no encontrada'});
 const r=await query('SELECT i.id FROM chat_images i JOIN chat_messages m ON m.image_id=i.id WHERE i.id=$1 AND i.uploaded=true',[req.params.id]);
 if(!r.rows.length)return res.status(404).json({error:'Imagen no encontrada'});
 const token=await imageTicket(req.params.id,'read');
 const upstream=await fetch(IMAGE_BRIDGE,{method:'POST',headers:{'x-image-ticket':token},signal:AbortSignal.timeout(25000)});
 if(!upstream.ok)return res.status(503).json({error:'No se pudo abrir la imagen. Intenta de nuevo.'});
 const d=await upstream.json();
 if(typeof d.url!=='string'||!d.url.startsWith('https://efijxswzpaapuqwrardk.supabase.co/storage/v1/object/sign/chat-images/'))return res.status(502).end();
 res.set('Referrer-Policy','no-referrer');res.redirect(302,d.url);
});

app.get('/api/chat',...chatAuth,async(req,res)=>{
  const before=req.query.before===undefined?null:Number(req.query.before);
  const after=req.query.after===undefined?null:Number(req.query.after);
  if((before!==null&&!positiveInt(before))||(after!==null&&(!Number.isSafeInteger(after)||after<0))||(before!==null&&after!==null))return res.status(400).json({error:'Página inválida'});
  const {rows}=await query(`SELECT m.id,m.author_id,m.body,m.image_id,m.created_at,u.name,u.role FROM chat_messages m JOIN users u ON u.id=m.author_id
    WHERE ($1::integer IS NULL OR m.id<$1) AND ($2::integer IS NULL OR m.id>$2)
    ORDER BY m.id ${after===null?'DESC':'ASC'} LIMIT 51`,[before,after]);
  const hasMore=rows.length>50,messages=rows.slice(0,50);if(after===null)messages.reverse();
  const unread=await query(`SELECT count(*)::int AS count FROM chat_messages WHERE author_id<>$1 AND id>COALESCE((SELECT last_message_id FROM chat_reads WHERE user_id=$1),0)`,[req.session.user.id]);
  res.json({messages,hasMore,unread:unread.rows[0].count});
});
app.post('/api/chat',...chatAuth,async(req,res)=>{
  const {body,clientId,imageId=null}=req.body;
  if(typeof body!=='string'||(!body.trim()&&!imageId)||body.length>2000||(imageId!==null&&!imageIdValid(imageId))||typeof clientId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId))return res.status(400).json({error:'Escribe un mensaje de 1 a 2000 caracteres'});
  const prior=await query('SELECT id FROM chat_messages WHERE author_id=$1 AND client_id=$2',[req.session.user.id,clientId]);
  if(prior.rows.length)return res.json({ok:true,id:prior.rows[0].id});
  if(imageId){
    const image=await query("SELECT i.id FROM chat_images i JOIN users u ON u.id=i.author_id WHERE i.id=$1 AND i.author_id=$2 AND i.uploaded=true AND i.created_at>now()-interval '24 hours' AND u.email='eri' AND u.role='tutor' AND NOT EXISTS(SELECT 1 FROM chat_messages m WHERE m.image_id=i.id)",[imageId,req.session.user.id]);
    if(!image.rows.length)return res.status(400).json({error:'Imagen no disponible para enviar. Vuelve a adjuntarla.'});
  }
  const {rows}=await query(`INSERT INTO chat_messages(author_id,body,client_id,image_id)
    SELECT $1,$2,$3,$4 WHERE (SELECT count(*) FROM chat_messages WHERE author_id=$1 AND created_at>now()-interval '1 minute')<20
    ON CONFLICT(author_id,client_id) DO UPDATE SET client_id=EXCLUDED.client_id RETURNING id`,[req.session.user.id,body.trim(),clientId,imageId]);
  if(!rows.length)return res.status(429).json({error:'Espera un momento antes de enviar más mensajes'});
  res.status(201).json({ok:true,id:rows[0].id});
});
app.post('/api/chat/read',...chatAuth,async(req,res)=>{
  const id=req.body.lastId;
  if(!Number.isSafeInteger(id)||id<0)return res.status(400).json({error:'Mensaje inválido'});
  await query(`INSERT INTO chat_reads(user_id,last_message_id)
    VALUES($1,LEAST($2,COALESCE((SELECT max(id) FROM chat_messages),0)))
    ON CONFLICT(user_id) DO UPDATE SET last_message_id=GREATEST(chat_reads.last_message_id,EXCLUDED.last_message_id)`,[req.session.user.id,id]);
  res.json({ok:true});
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
