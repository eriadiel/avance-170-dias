const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const bcrypt=require('bcryptjs');
const {randomBytes}=require('node:crypto');

test('migration, APIs, role isolation and persistent sessions on PostgreSQL',async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;
 CREATE TABLE users(id serial PRIMARY KEY,name text,email text UNIQUE,password_hash text,role text);
 CREATE TABLE progress(id serial PRIMARY KEY,student_id integer REFERENCES users(id),day integer,completed boolean,completed_at timestamptz,student_note text,tutor_status text,tutor_note text,verified_at timestamptz,UNIQUE(student_id,day));
 CREATE TABLE user_sessions(sid varchar PRIMARY KEY,sess json NOT NULL,expire timestamp NOT NULL);`);
 const password=randomBytes(24).toString('hex'),hash=await bcrypt.hash(password,4);
 await db.query("INSERT INTO users(name,email,password_hash,role) VALUES('Student','student@test.invalid',$1,'student'),('Tutor','tutor@test.invalid',$1,'tutor'),('Other','other@test.invalid',$1,'student')",[hash]);
 await db.exec("INSERT INTO progress VALUES(41,1,7,true,'2026-09-20T12:00Z','original evidence','verified','original feedback','2026-09-21T12:00Z');");
 await db.exec(fs.readFileSync(require.resolve('../database/chat.sql'),'utf8'));
 const before=(await db.query('SELECT * FROM progress')).rows;
 await db.exec(fs.readFileSync(require.resolve('../database/upgrade.sql'),'utf8'));
 assert.deepEqual((await db.query('SELECT * FROM progress')).rows,before);
 const migrated=(await db.query("SELECT * FROM class_progress WHERE class_id='science'")).rows[0];
 const {id,...expected}=before[0];assert.deepEqual(migrated,{...expected,class_id:'science'});
 await db.exec("UPDATE progress SET student_note='rollout write' WHERE id=41");
 assert.equal((await db.query('SELECT student_note FROM class_progress')).rows[0].student_note,'rollout write');
 // Adapt the embedded PostgreSQL wire interface to pg.Pool for real session-store SQL.
 const query=async(sql,params)=>{const r=await db.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length};};
 const pool={query:(sql,params,cb)=>{if(typeof params==='function'){cb=params;params=undefined;}if(typeof sql==='object'){params=sql.values;sql=sql.text;}const p=query(sql,params);if(cb){p.then(r=>cb(null,r),cb);return;}return p;},on:()=>{}};
 require.cache[require.resolve('../db')]={id:require.resolve('../db'),filename:require.resolve('../db'),loaded:true,exports:{query,pool}};
 const app=require('../server');let server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=()=>`http://127.0.0.1:${server.address().port}`;
 async function request(route,{cookie,body,method,headers}={}){
  const r=await fetch(base()+route,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
  return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 try{
  assert.equal((await request('/api/progress')).status,401);
  assert.equal((await request('/api/course/science')).status,401);
  assert.equal((await request('/api/login',{body:{email:'student@test.invalid',password:'wrong'}})).status,401);
  const login=await request('/api/login',{body:{email:'student@test.invalid',password}});assert.equal(login.status,200);const student=login.cookie;
  assert.ok(student);assert.equal((await request('/api/me',{cookie:student})).body.user.id,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM user_sessions')).rows[0].n,1);
  await new Promise(r=>server.close(r));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  assert.equal((await request('/api/me',{cookie:student})).body.user.id,1);
  assert.equal((await request('/api/students',{cookie:student})).status,403);
  assert.equal((await request('/api/progress?studentId=3',{cookie:student})).status,403);
  assert.equal((await request('/api/verify',{cookie:student,body:{}})).status,403);
  assert.equal((await request('/api/progress',{cookie:student,body:{classId:'science',day:1.5,completed:true}})).status,400);
  assert.equal((await request('/api/progress',{cookie:student,body:{classId:'science',day:1,completed:'false'}})).status,400);
  assert.equal((await request('/api/progress',{cookie:student,body:{classId:'science',day:1,completed:true},headers:{Origin:'https://unrelated.invalid'}})).status,403);
  const subjects=(await request('/api/course',{cookie:student})).body.classes;
  for(const c of subjects){assert.equal((await request('/api/course/'+c.id,{cookie:student})).body.days.length,170);}
  for(const c of subjects.slice(0,4))assert.equal((await request('/api/progress',{cookie:student,body:{classId:c.id,day:1,completed:true,note:c.id}})).status,200);
  assert.equal((await request('/api/progress',{cookie:student})).body.summary.completed,0);
  await request('/api/progress',{cookie:student,body:{classId:'bible',day:1,completed:true,note:'bible'}});
  assert.equal((await request('/api/progress',{cookie:student})).body.summary.completed,1);
  const tutor=(await request('/api/login',{body:{email:'tutor@test.invalid',password}})).cookie;
  assert.equal((await request('/api/progress',{cookie:tutor,body:{classId:'bible',day:1,completed:false}})).status,403);
  assert.equal((await request('/api/verify',{cookie:tutor,body:{studentId:1,classId:'english',day:2,status:'verified'}})).status,409);
  for(const c of subjects)assert.equal((await request('/api/verify',{cookie:tutor,body:{studentId:1,classId:c.id,day:1,status:'verified',note:'checked'}})).status,200);
  assert.equal((await request('/api/progress?studentId=1',{cookie:tutor})).body.summary.verified,1);
  await request('/api/verify',{cookie:tutor,body:{studentId:1,classId:'bible',day:1,status:'returned',note:'revise'}});
  let data=(await request('/api/progress',{cookie:student})).body;
  assert.equal(data.summary.completed,1);assert.equal(data.summary.verified,0);
  await request('/api/progress',{cookie:student,body:{classId:'bible',day:1,completed:false,note:'changed'}});
  data=(await request('/api/progress',{cookie:student})).body;assert.equal(data.summary.completed,0);
  assert.equal(data.progress.find(p=>p.class_id==='science'&&p.day===1).tutor_status,'verified');
  assert.equal(data.progress.find(p=>p.class_id==='bible').tutor_status,'pending');
  assert.equal((await request('/api/progress?studentId=3',{cookie:tutor})).body.progress.length,0);
  
  assert.equal((await request('/api/chat')).status,401);
  assert.equal((await request('/api/chat',{body:{body:'blocked',clientId:require('crypto').randomUUID()}})).status,401);
  assert.equal((await request('/api/chat',{cookie:student,body:{body:'  ',clientId:require('crypto').randomUUID()}})).status,400);
  assert.equal((await request('/api/chat',{cookie:student,body:{body:'x'.repeat(2001),clientId:require('crypto').randomUUID()}})).status,400);
  const clientId=require('crypto').randomUUID();
  const sent=await request('/api/chat',{cookie:student,body:{body:'Hola <script>alert(1)</script>',clientId,author_id:2}});
  assert.equal(sent.status,201);
  assert.equal((await request('/api/chat',{cookie:student,body:{body:'Hola <script>alert(1)</script>',clientId}})).body.id,sent.body.id);
  let chat=(await request('/api/chat',{cookie:tutor})).body;
  assert.equal(chat.messages.length,1);assert.equal(chat.messages[0].author_id,1);assert.equal(chat.unread,1);
  assert.equal((await request('/api/chat/read',{cookie:tutor,body:{lastId:sent.body.id}})).status,200);
  assert.equal((await request('/api/chat',{cookie:tutor})).body.unread,0);
  const reply=await request('/api/chat',{cookie:tutor,body:{body:'Respuesta tutor',clientId:require('crypto').randomUUID()}});
  assert.equal(reply.status,201);
  assert.equal((await request('/api/chat?after='+sent.body.id,{cookie:student})).body.messages[0].author_id,2);
  assert.equal((await request('/api/chat?before='+reply.body.id,{cookie:student})).body.messages[0].id,sent.body.id);
  assert.equal((await request('/api/chat?after=-1',{cookie:student})).status,400);
  assert.equal((await request('/api/chat',{cookie:student,body:{body:'CSRF',clientId:require('crypto').randomUUID()},headers:{Origin:'https://unrelated.invalid'}})).status,403);
  assert.equal((await db.query("SELECT has_table_privilege('anon','chat_messages','SELECT') AS allowed")).rows[0].allowed,false);
  assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE relname='chat_messages'")).rows[0].relrowsecurity,true);
  await new Promise(r=>server.close(r));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  assert.equal((await request('/api/chat',{cookie:tutor})).body.messages.length,2);
  await request('/api/logout',{cookie:student,method:'POST'});
  assert.equal((await request('/api/chat',{cookie:student})).status,401);

  assert.equal((await request('/api/progress',{cookie:student})).status,401);
 }finally{await new Promise(r=>server.close(r));await db.close();}
});
