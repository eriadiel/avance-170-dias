const app=document.getElementById('app');
const fresh=()=>({user:null,course:null,progress:[],summary:null,students:[],studentId:null,view:'dashboard',classId:'science',day:1,cache:{},busy:false,message:'',chat:{messages:[],unread:0,loaded:false,hasOlder:false,draft:'',sending:false,error:'',read:0,pending:null}});
let state=fresh();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,opt={}){
  const r=await fetch(url,{...opt,headers:{'Content-Type':'application/json',...opt.headers},credentials:'same-origin'});
  const d=await r.json();
  if(!r.ok){if(r.status===401&&url!=='/api/login'){state=fresh();login('Tu sesión terminó. Vuelve a entrar.');}throw new Error(d.error||'No se pudo completar la solicitud');}
  return d;
}
function login(message=''){
  app.innerHTML=`<div class="login"><form class="login-card" id="login-form"><span class="eyebrow">APRENDER, DÍA A DÍA</span><h1>Avance 170 días</h1><p class="muted">Cinco materias. Un camino compartido entre estudiante y tutor.</p><div class="field"><label for="username">Usuario</label><input id="username" name="username" type="text" autocomplete="username" required></div><div class="field"><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><button type="submit">Entrar</button><p id="login-error" role="alert">${esc(message)}</p></form></div>`;
  document.getElementById('login-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,btn=form.querySelector('button');btn.disabled=true;try{const d=await api('/api/login',{method:'POST',body:JSON.stringify({username:form.username.value,password:form.password.value})});state=fresh();state.user=d.user;await load();}catch(e){document.getElementById('login-error').textContent=e.message;btn.disabled=false;}};
}
async function refresh(){
  if(state.user.role==='tutor'&&!state.studentId){state.progress=[];state.summary=null;return;}
  const d=await api('/api/progress'+(state.user.role==='tutor'?'?studentId='+state.studentId:''));state.progress=d.progress;state.summary=d.summary;
}
async function load(){
  state.course=await api('/api/course');
  if(state.user.role==='tutor'){state.students=await api('/api/students');state.studentId=state.students[0]?.id||null;}
  await refresh();render();scheduleChat(0);
}
const getP=(id,day)=>state.progress.find(p=>p.class_id===id&&p.day===day)||{completed:false,tutor_status:'pending',student_note:''};
function badge(p){const label=!p.completed?'Pendiente':p.tutor_status==='verified'?'Verificado':p.tutor_status==='returned'?'Devuelto':'Completado · por revisar';return `<span class="badge ${p.completed?(p.tutor_status==='verified'?'ok':p.tutor_status==='returned'?'returned':'pending'):''}">${label}</span>`;}
function render(){
  if(!state.user)return login();
  const tutor=state.user.role==='tutor';
  app.innerHTML=`<header class="topbar"><div class="inner"><div class="brand">Avance <span>170 días</span></div><div>${esc(state.user.name)} · ${tutor?'Tutor':'Estudiante'} <button class="secondary" data-action="logout">Salir</button></div></div></header><div class="container"><div class="layout"><aside class="sidebar card"><span class="eyebrow">MI PLAN DE ESTUDIO</span>${[['dashboard','Resumen'],['days','Vista por día'],['class','Mis materias'],['assessments','Quizes/Tests'],['chat','Chat']].map(([v,l])=>`<button class="${state.view===v?'active':''}" data-view="${v}">${l}${v==='chat'?' <span id="chat-unread" class="chat-unread" aria-label="Mensajes sin leer"></span>':''}</button>`).join('')}${tutor?'<p class="hint">Selecciona una materia y día para verificar el trabajo.</p>':''}</aside><main class="main">${tutor&&state.view!=='chat'?`<div class="field student-picker"><label for="student">Estudiante</label><select id="student">${state.students.map(s=>`<option value="${s.id}" ${s.id===state.studentId?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>`:''}<div role="status" class="notice" ${state.message?'':'hidden'}>${esc(state.message)}</div>${tutor&&!state.studentId&&state.view!=='chat'?'<div class="empty card">No hay estudiantes.</div>':state.view==='dashboard'?dashboard():state.view==='days'?daysView():state.view==='assessments'?assessmentsView():state.view==='chat'?chatView():classView()}</main></div></div>`;
  app.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>navigate(b.dataset.view));
  app.querySelector('[data-action="logout"]').onclick=logout;
  app.querySelector('#student')?.addEventListener('change',async e=>{state.studentId=Number(e.target.value);try{await refresh();render();}catch(e){showError(e);}});
  app.querySelectorAll('[data-class]').forEach(b=>b.onclick=()=>openLesson(b.dataset.class,Number(b.dataset.day||state.day)));
  app.querySelector('#class-select')?.addEventListener('change',e=>openLesson(e.target.value,state.day));
  app.querySelector('#day-select')?.addEventListener('change',e=>openLesson(state.classId,Number(e.target.value)));
  app.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>openLesson(state.classId,state.day+Number(b.dataset.step)));
  app.querySelector('#save-lesson')?.addEventListener('click',saveLesson);
  bindChat();
  app.querySelectorAll('[data-verify]').forEach(b=>b.onclick=()=>verify(b.dataset.verify));
}

const schoolHolidays=['2026-10-07','2026-10-08','2026-10-09','2026-10-30','2026-12-23','2026-12-24','2026-12-25','2026-12-30','2026-12-31','2027-01-01','2027-03-24','2027-03-25','2027-03-26'];
function schoolCalendar(){
  const dates=[],holidaySet=new Set(schoolHolidays),date=new Date('2026-09-21T12:00:00Z');
  while(dates.length<170){
    const key=date.toISOString().slice(0,10),weekday=date.getUTCDay();
    if(weekday!==0&&weekday!==6&&!holidaySet.has(key))dates.push(key);
    date.setUTCDate(date.getUTCDate()+1);
  }
  return dates;
}
function schoolDateLabel(key,options={day:'numeric',month:'long',year:'numeric'}){
  return new Intl.DateTimeFormat('es-HN',{...options,timeZone:'UTC'}).format(new Date(key+'T12:00:00Z'));
}
function calendarGoal(today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Tegucigalpa',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())){
  const dates=schoolCalendar(),end=dates[169],elapsed=dates.filter(d=>d<today).length,remaining=170-elapsed;
  const months=[...new Set(dates.map(d=>d.slice(0,7)))];
  const current=dates.indexOf(today),next=dates.find(d=>d>=today);
  return `<section class="card calendar-goal" aria-labelledby="calendar-title"><div class="goal-heading"><div><span class="eyebrow">NUESTRA META · 170 DÍAS DE CLASE</span><h2 id="calendar-title">Llegamos el ${schoolDateLabel(end)}</h2><p class="muted">Desde el 21 de septiembre de 2026 · lunes a viernes · vacaciones excluidas.</p></div><div class="goal-count"><strong>${remaining}</strong><span>días de clase por delante</span></div></div><p>${today>end?'El calendario previsto ha finalizado.':current>=0?`Hoy corresponde el día ${current+1} de 170.`:next?`Próxima clase: ${schoolDateLabel(next)} · día ${dates.indexOf(next)+1}.`:'La meta del calendario se ha cumplido.'}</p><div class="goal-track"><span aria-hidden="true">Inicio · 21 sep 2026</span><progress max="170" value="${elapsed}" aria-label="Días de clase transcurridos en el calendario"></progress><span aria-hidden="true">Meta · ${schoolDateLabel(end,{day:'numeric',month:'short',year:'numeric'})}</span></div><p class="hint">${elapsed} de 170 jornadas transcurridas antes de hoy. Las restantes incluyen la clase de hoy, si corresponde. Este calendario no cambia el avance guardado de las materias.</p><div class="goal-months" aria-label="Distribución de clases por mes">${months.map(m=>{const all=dates.filter(d=>d.startsWith(m)),passed=all.filter(d=>d<today).length;return `<div class="goal-month"><span>${schoolDateLabel(m+'-01',{month:'short',year:'numeric'})}</span><progress max="${all.length}" value="${passed}" aria-label="${schoolDateLabel(m+'-01',{month:'long',year:'numeric'})}: ${passed} de ${all.length} días transcurridos"></progress><small>${all.length} días de clase</small></div>`;}).join('')}</div><details class="holiday-list" open><summary>Vacaciones · 13 fechas sin clases</summary><ul>${schoolHolidays.map(d=>`<li><span aria-hidden="true">☀</span> ${schoolDateLabel(d,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}${new Date(d+'T12:00:00Z').getUTCDay()===6?' <span class="hint">(sábado: no desplaza la meta)</span>':''}</li>`).join('')}</ul><p class="hint">Las 13 fechas caen de lunes a viernes y se excluyen del conteo.</p></details></section>`;
}

function dashboard(){
  const s=state.summary;if(!s)return '';
  return `<span class="eyebrow">CINCO MATERIAS · 170 DÍAS</span><h1>Tu avance, en conjunto</h1><p class="muted">Un día cuenta cuando sus cinco materias están completadas.</p><div class="stats"><div class="stat card"><span class="muted">Días completos</span><strong>${s.completed}/170</strong></div><div class="stat card"><span class="muted">Avance global</span><strong>${Math.round(s.completed/170*100)}%</strong></div><div class="stat card"><span class="muted">Días verificados</span><strong>${s.verified}/170</strong></div><div class="stat card"><span class="muted">Lecciones por revisar</span><strong>${s.byClass.reduce((n,c)=>n+c.pending,0)}</strong></div></div>${calendarGoal()}<h2>Progreso por materia</h2><div class="subject-grid">${state.course.classes.map(c=>{const p=s.byClass.find(x=>x.id===c.id);return `<article class="card subject-card"><h3>${esc(c.name)}</h3><div class="subject-count"><strong>${p.completed}</strong><span class="muted"> / 170 completadas</span></div><progress value="${p.completed}" max="170" aria-label="Avance ${esc(c.name)}"></progress><p class="hint">${p.verified} verificadas · ${p.pending} por revisar · ${p.returned} devueltas</p><button class="secondary" data-class="${c.id}">Abrir materia</button></article>`;}).join('')}</div>`;
}
function daysView(){
  return `<h1>Vista por día</h1><p class="muted">Cada fila reúne las cinco materias. Abre una celda para ver su lección.</p><div class="table-wrap card"><table><caption class="sr-only">Estado de las cinco materias en los 170 días</caption><thead><tr><th scope="col">Día</th>${state.course.classes.map(c=>`<th scope="col">${esc(c.name)}</th>`).join('')}<th scope="col">Global</th></tr></thead><tbody>${state.summary.days.map(d=>`<tr><th scope="row">${d.day}</th>${state.course.classes.map(c=>`<td><button class="cell-button" data-class="${c.id}" data-day="${d.day}" aria-label="${esc(c.name)}, día ${d.day}">${badge(getP(c.id,d.day))}</button></td>`).join('')}<td>${d.completed?'<span class="badge ok">Completo</span>':'<span class="muted">Pendiente</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}
const headings={'Pages Taught':'Lesson / Pages Taught','Lesson Taught':'Lesson / Pages Taught','Materials Needed':'Materials Needed · Materiales','Teacher Instructions':'Teacher Instructions · Instrucciones','Homework':'Homework · Tarea','Reminder':'Reminder · Recordatorio','Continuation':'Continuación del manual'};

const assessmentPattern=/\b(?:quiz(?:zes)?|tests?|exams?|examinations?)\b/i;
function lessonAssessments(d){
  return d.sections.filter(s=>/^Materials? Needed$/i.test(s.heading))
    .flatMap(s=>s.text.split('\n')).map(t=>t.trim()).filter(t=>assessmentPattern.test(t))
    .filter((t,i,a)=>a.indexOf(t)===i);
}
function lessonBlocks(d){
  const alerts=lessonAssessments(d);
  const banner=alerts.length?'<aside class="assessment-banner" aria-label="Evaluación en esta lección"><span class="lesson-icon" aria-hidden="true">✎</span><div><span class="eyebrow">PREPARA TU EVALUACIÓN</span><h3>Quiz / test en los materiales de esta lección</h3><ul>'+alerts.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul><p>Revisa las instrucciones del día para realizar la evaluación.</p></div></aside>':'';
  const types={
    'Pages Taught':['pages','▤','Páginas de hoy'],
    'Lesson Taught':['pages','▤','Contenido de hoy'],
    'Materials Needed':['materials','▣','Prepara tus materiales'],
    'Teacher Instructions':['instructions','☷','Paso a paso'],
    'Homework':['homework','⌂','Tarea y preparación'],
    'Reminder':['reminder','◷','Recordatorios'],
    'Continuation':['continuation','↳','Continuación']
  };
  return banner+'<div class="lesson-grid">'+d.sections.map(s=>{
    const [kind,icon,title]=types[s.heading]||['continuation','▤',s.heading];
    let body='<div class="source-text">'+esc(s.text)+'</div>';
    if(kind==='materials') body='<ul class="material-list">'+s.text.split('\n').filter(t=>t.trim()).map(t=>'<li class="'+(assessmentPattern.test(t)?'assessment-material':'')+'"><span aria-hidden="true">'+(assessmentPattern.test(t)?'✎':'•')+'</span><span>'+esc(t)+'</span></li>').join('')+'</ul>';
    if(kind==='instructions'){
      const parts=s.text.split(/(?=^\s*\d+\.\s)/m).filter(t=>t.trim());
      body='<div class="instruction-list">'+parts.map(t=>{
        const match=t.match(/^\s*(\d+)\.\s+([\s\S]*)$/);
        return match?'<div class="instruction-step"><span class="step-number" aria-hidden="true">'+esc(match[1])+'</span><div class="source-text"><span class="sr-only">'+esc(match[1])+'. </span>'+esc(match[2])+'</div></div>':'<div class="source-text">'+esc(t)+'</div>';
      }).join('')+'</div>';
    }
    return '<section class="lesson-block lesson-'+kind+'"><header><span class="lesson-icon" aria-hidden="true">'+icon+'</span><div><h3>'+esc(title)+'</h3><p>'+esc(s.heading)+'</p></div></header>'+body+'</section>';
  }).join('')+'</div>';
}


function assessmentsView(){
  const name=state.user.role==='tutor'?state.students.find(s=>s.id===state.studentId)?.name:state.user.name;
  const intro=`<span class="eyebrow">PLAN DE EVALUACIONES · ${esc(name)}</span><h1>Quizes/Tests</h1><p class="muted">Consulta en qué lessons hay quizzes, tests o exámenes en cada asignatura. Abre una lección para ver sus instrucciones.</p><p class="hint">Se incluyen las menciones de Materials Needed; los recordatorios de evaluaciones futuras no se cuentan aquí. El estado corresponde al avance de la lección, no a una calificación.</p>`;
  if(state.course.classes.some(c=>!state.cache[c.id]))return intro+'<div class="card empty" role="status">Cargando evaluaciones…</div><button class="secondary" data-view="assessments">Reintentar carga</button>';
  return intro+state.course.classes.map(c=>{
    const rows=state.cache[c.id].days.map(d=>({day:d.day,items:lessonAssessments(d)})).filter(d=>d.items.length).sort((a,b)=>a.day-b.day);
    const quizzes=rows.filter(d=>d.items.some(t=>/\bquiz(?:zes)?\b/i.test(t))).length;
    const tests=rows.filter(d=>d.items.some(t=>/\b(?:tests?|exams?|examinations?)\b/i.test(t))).length;
    return `<section class="card assessment-subject"><h2>${esc(c.name)}</h2><p class="assessment-counts"><span>${rows.length} lessons con evaluaciones</span><span>${quizzes} con quiz</span><span>${tests} con test / examen</span></p><details><summary>Ver lessons de ${esc(c.name)}</summary>${rows.length?`<ul class="assessment-schedule">${rows.map(d=>`<li><button class="secondary" data-class="${esc(c.id)}" data-day="${d.day}" aria-label="Abrir ${esc(c.name)}, Lesson ${d.day}">Lesson ${d.day} <span aria-hidden="true">↗</span></button><div class="assessment-items">${d.items.map(t=>`<span>${esc(t)}</span>`).join('')}</div><div>${badge(getP(c.id,d.day))}</div></li>`).join('')}</ul>`:'<p>No hay quizzes, tests o exámenes indicados en los materiales de esta asignatura.</p>'}</details></section>`;
  }).join('');
}

function classView(){
  const c=state.cache[state.classId],p=getP(state.classId,state.day),d=c?.days.find(d=>d.day===state.day);
  return `<h1>Materias y lecciones</h1><div class="lesson-controls card"><div class="field"><label for="class-select">Materia</label><select id="class-select">${state.course.classes.map(c=>`<option value="${c.id}" ${c.id===state.classId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div class="field"><label for="day-select">Día / Lesson</label><select id="day-select">${Array.from({length:170},(_,i)=>`<option value="${i+1}" ${i+1===state.day?'selected':''}>Día ${i+1}</option>`).join('')}</select></div><div class="actions"><button class="secondary" data-step="-1" ${state.day===1?'disabled':''}>Anterior</button><button class="secondary" data-step="1" ${state.day===170?'disabled':''}>Siguiente</button></div></div>${d?`<article class="day card"><div class="day-head"><div><span class="eyebrow">${esc(c.name)}</span><h2>Día ${d.day} · Lesson ${d.day}</h2></div>${badge(p)}</div><p class="hint">Fuente: ${esc(c.source.filename)} · páginas PDF ${d.sourcePages.join(', ')}. Contenido conservado en el idioma del manual.</p>${lessonBlocks(d)}<details><summary>Referencias a quizzes, tests, exams y proyectos</summary><p class="hint">Son menciones textuales; las instrucciones completas y fechas están arriba.</p>${d.assessmentMentions.length?`<ul>${d.assessmentMentions.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:'<p>No hay menciones explícitas en esta lección.</p>'}</details><details><summary>Texto completo extraído del Daily Guide</summary><pre class="source-text">${esc(d.sourceText)}</pre></details><div class="work-panel"><h3>${state.user.role==='student'?'Mi trabajo':'Revisión del tutor'}</h3>${state.user.role==='student'?`<label class="checkline"><input id="completed" type="checkbox" ${p.completed?'checked':''}> He completado esta materia en el día ${d.day}</label><div class="field"><label for="student-note">Nota o evidencia para el tutor</label><textarea id="student-note" rows="3" maxlength="2000">${esc(p.student_note)}</textarea></div><button id="save-lesson" ${state.busy?'disabled':''}>Guardar avance</button><p class="hint">Al cambiar el trabajo o la nota, la revisión vuelve a pendiente.</p>`:`<p><b>Nota del estudiante:</b> ${esc(p.student_note||'Sin nota')}</p><div class="field"><label for="tutor-note">Comentario del tutor</label><textarea id="tutor-note" rows="3" maxlength="2000">${esc(p.tutor_note)}</textarea></div><div class="actions"><button data-verify="verified" ${!p.completed||state.busy?'disabled':''}>Verificar</button><button class="danger" data-verify="returned" ${!p.completed||state.busy?'disabled':''}>Devolver</button></div>${!p.completed?'<p class="hint">El estudiante debe completar esta lección antes de revisarla.</p>':''}`} ${p.tutor_note?`<div class="note"><b>Comentario del tutor:</b> ${esc(p.tutor_note)}</div>`:''}</div></article>`:'<p role="status">Cargando lección…</p>'}`;
}
async function navigate(view){state.view=view;state.message='';if(view==='class')return openLesson(state.classId,state.day);render();if(view==='chat')scheduleChat(0);if(view==='assessments'){const session=state;try{await Promise.all(state.course.classes.map(async c=>{if(!session.cache[c.id])session.cache[c.id]=await api('/api/course/'+encodeURIComponent(c.id));}));if(state===session&&state.view===view)render();}catch(e){if(state===session&&state.view===view)showError(e);}}}
async function openLesson(id,day){if(day<1||day>170)return;state.view='class';state.classId=id;state.day=day;state.message='';try{if(!state.cache[id])state.cache[id]=await api('/api/course/'+encodeURIComponent(id));render();}catch(e){showError(e);}}
function showError(e){state.message=e.message;if(state.user)render();}
async function saveLesson(){
  if(state.busy)return;const body={classId:state.classId,day:state.day,completed:document.getElementById('completed').checked,note:document.getElementById('student-note').value};
  state.busy=true;document.getElementById('save-lesson').disabled=true;
  try{await api('/api/progress',{method:'POST',body:JSON.stringify(body)});await refresh();state.message='Avance guardado.';}catch(e){state.message=e.message;}finally{state.busy=false;render();}
}
async function verify(status){
  if(state.busy)return;const body={studentId:state.studentId,classId:state.classId,day:state.day,status,note:document.getElementById('tutor-note').value};state.busy=true;
  try{await api('/api/verify',{method:'POST',body:JSON.stringify(body)});await refresh();state.message=status==='verified'?'Lección verificada.':'Lección devuelta para revisión.';}catch(e){state.message=e.message;}finally{state.busy=false;render();}
}
async function logout(){try{await api('/api/logout',{method:'POST'});state=fresh();login();}catch(e){showError(e);}}

let chatTimer,chatFetching=false;
function chatView(){
  return `<span class="eyebrow">LOPEZCOTOACADEMY · SALA COMPARTIDA</span><h1>Chat</h1><p class="muted">Un espacio para estudiantes y tutores. Todos los usuarios pueden leer los mensajes de esta sala.</p><section class="card chat-card"><div class="chat-toolbar"><span id="chat-connection" role="status">Actualización automática cada pocos segundos</span><button id="chat-refresh" class="secondary">Actualizar</button></div><button id="chat-older" class="secondary" ${state.chat.hasOlder?'':'hidden'}>Cargar mensajes anteriores</button><div id="chat-messages" class="chat-messages" role="log" aria-label="Mensajes de la sala" aria-live="polite" aria-relevant="additions" tabindex="0"></div><p id="chat-error" role="alert"></p><form id="chat-form"><label for="chat-draft">Tu mensaje</label><textarea id="chat-draft" rows="3" maxlength="2000" placeholder="Escribe para la sala…" required>${esc(state.chat.draft)}</textarea><div class="chat-compose-footer"><span class="hint">Hasta 2000 caracteres · Shift + Enter para un salto de línea</span><button id="chat-send" type="submit" ${state.chat.sending?'disabled':''}>${state.chat.sending?'Enviando…':'Enviar'}</button></div></form></section>`;
}
function chatMessage(m){
  const own=m.author_id===state.user.id;
  const time=new Intl.DateTimeFormat('es-HN',{timeZone:'America/Tegucigalpa',dateStyle:'medium',timeStyle:'short'}).format(new Date(m.created_at));
  return `<article class="chat-message ${own?'chat-own':''}" data-message-id="${m.id}"><header><strong>${esc(m.name)}</strong><span>${m.role==='tutor'?'Tutor':'Estudiante'}${own?' · Tú':''}</span><time datetime="${esc(m.created_at)}">${esc(time)}</time></header><p>${esc(m.body)}</p></article>`;
}
function updateChatBadge(){
  const b=document.getElementById('chat-unread');if(b){b.textContent=state.chat.unread?String(state.chat.unread):'';b.hidden=!state.chat.unread;}
}
function paintChat(initial=false){
  updateChatBadge();
  const box=document.getElementById('chat-messages');if(!box)return;
  const bottom=initial||box.scrollHeight-box.scrollTop-box.clientHeight<70;
  const rendered=new Set([...box.querySelectorAll('[data-message-id]')].map(e=>Number(e.dataset.messageId)));
  if(state.chat.messages.length){box.querySelector('.chat-empty')?.remove();for(const m of state.chat.messages)if(!rendered.has(m.id))box.insertAdjacentHTML('beforeend',chatMessage(m));}
  else box.innerHTML='<p class="chat-empty muted">'+(state.chat.loaded?'Todavía no hay mensajes. Escribe el primero.':'Cargando mensajes…')+'</p>';
  document.getElementById('chat-older').hidden=!state.chat.hasOlder;
  document.getElementById('chat-error').textContent=state.chat.error;
  if(bottom){box.scrollTop=box.scrollHeight;markChatRead();}
}
function bindChat(){
  updateChatBadge();
  const form=document.getElementById('chat-form');if(!form)return;
  paintChat(true);
  const draft=document.getElementById('chat-draft');
  draft.oninput=()=>{state.chat.draft=draft.value;state.chat.pending=null;};
  draft.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}};
  form.onsubmit=sendChat;
  document.getElementById('chat-refresh').onclick=()=>scheduleChat(0);
  document.getElementById('chat-older').onclick=olderChat;
  document.getElementById('chat-messages').onscroll=markChatRead;
}
async function markChatRead(){
  const session=state,box=document.getElementById('chat-messages');
  if(!session.user||document.hidden||!box||box.scrollHeight-box.scrollTop-box.clientHeight>=70)return;
  const last=session.chat.messages.at(-1)?.id||0;if(last<=session.chat.read)return;
  const prior=session.chat.read;session.chat.read=last;
  try{await api('/api/chat/read',{method:'POST',body:JSON.stringify({lastId:last})});if(state===session){session.chat.unread=0;updateChatBadge();}}
  catch(e){if(state===session)session.chat.read=prior;}
}
function scheduleChat(delay){clearTimeout(chatTimer);chatTimer=setTimeout(pollChat,delay);}
async function pollChat(){
  if(!state.user)return;
  if(document.hidden||chatFetching){scheduleChat(4000);return;}
  const session=state;chatFetching=true;
  try{
    const active=session.view==='chat',last=session.chat.messages.at(-1)?.id;
    const d=await api('/api/chat'+(active&&last?'?after='+last:''));
    if(state!==session)return;
    session.chat.unread=d.unread;session.chat.error='';
    if(active){
      if(!session.chat.loaded){session.chat.hasOlder=d.hasMore;session.chat.loaded=true;}
      const ids=new Set(session.chat.messages.map(m=>m.id));
      session.chat.messages.push(...d.messages.filter(m=>!ids.has(m.id)));session.chat.messages.sort((a,b)=>a.id-b.id);
      paintChat(!last);
      if(last&&d.hasMore){scheduleChat(0);return;}
    }else updateChatBadge();
  }catch(e){if(state===session){session.chat.error='No se pudo actualizar el chat. Reintentaremos automáticamente.';const el=document.getElementById('chat-error');if(el)el.textContent=session.chat.error;}}
  finally{chatFetching=false;if(state.user)scheduleChat(state.view==='chat'?4000:15000);}
}
async function olderChat(){
  const session=state,button=document.getElementById('chat-older'),box=document.getElementById('chat-messages');
  button.disabled=true;
  try{const d=await api('/api/chat?before='+session.chat.messages[0].id);if(state!==session||state.view!=='chat')return;
    const height=box.scrollHeight,top=box.scrollTop,ids=new Set(session.chat.messages.map(m=>m.id)),older=d.messages.filter(m=>!ids.has(m.id));
    session.chat.messages.unshift(...older);session.chat.hasOlder=d.hasMore;
    box.insertAdjacentHTML('afterbegin',older.map(chatMessage).join(''));box.scrollTop=top+box.scrollHeight-height;button.hidden=!d.hasMore;
  }catch(e){if(state===session)document.getElementById('chat-error')?.replaceChildren(document.createTextNode(e.message));}
  finally{button.disabled=false;}
}
async function sendChat(e){
  e.preventDefault();const session=state,c=session.chat;if(c.sending||!c.draft.trim())return;
  const text=c.draft.trim();c.pending=c.pending||crypto.randomUUID();c.sending=true;c.error='';
  const button=document.getElementById('chat-send');button.disabled=true;button.textContent='Enviando…';
  try{await api('/api/chat',{method:'POST',body:JSON.stringify({body:text,clientId:c.pending})});if(state!==session)return;
    if(c.draft.trim()===text){c.draft='';const field=document.getElementById('chat-draft');if(field)field.value='';}c.pending=null;scheduleChat(0);
  }catch(e){if(state===session){c.error=e.message;const el=document.getElementById('chat-error');if(el)el.textContent=e.message;}}
  finally{c.sending=false;button.disabled=false;button.textContent='Enviar';}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.user)scheduleChat(0);});

(async()=>{try{const d=await api('/api/me');state.user=d.user;if(d.user)await load();else login();}catch(e){login(e.message);}})();
