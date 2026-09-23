const app=document.getElementById('app');
const fresh=()=>({user:null,course:null,progress:[],summary:null,students:[],studentId:null,view:'dashboard',classId:'science',day:1,cache:{},busy:false,message:''});
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
  await refresh();render();
}
const getP=(id,day)=>state.progress.find(p=>p.class_id===id&&p.day===day)||{completed:false,tutor_status:'pending',student_note:''};
function badge(p){const label=!p.completed?'Pendiente':p.tutor_status==='verified'?'Verificado':p.tutor_status==='returned'?'Devuelto':'Completado · por revisar';return `<span class="badge ${p.completed?(p.tutor_status==='verified'?'ok':p.tutor_status==='returned'?'returned':'pending'):''}">${label}</span>`;}
function render(){
  if(!state.user)return login();
  const tutor=state.user.role==='tutor';
  app.innerHTML=`<header class="topbar"><div class="inner"><div class="brand">Avance <span>170 días</span></div><div>${esc(state.user.name)} · ${tutor?'Tutor':'Estudiante'} <button class="secondary" data-action="logout">Salir</button></div></div></header><div class="container"><div class="layout"><aside class="sidebar card"><span class="eyebrow">MI PLAN DE ESTUDIO</span>${[['dashboard','Resumen'],['days','Vista por día'],['class','Mis materias'],['assessments','Quizes/Tests']].map(([v,l])=>`<button class="${state.view===v?'active':''}" data-view="${v}">${l}</button>`).join('')}${tutor?'<p class="hint">Selecciona una materia y día para verificar el trabajo.</p>':''}</aside><main class="main">${tutor?`<div class="field student-picker"><label for="student">Estudiante</label><select id="student">${state.students.map(s=>`<option value="${s.id}" ${s.id===state.studentId?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>`:''}<div role="status" class="notice" ${state.message?'':'hidden'}>${esc(state.message)}</div>${tutor&&!state.studentId?'<div class="empty card">No hay estudiantes.</div>':state.view==='dashboard'?dashboard():state.view==='days'?daysView():state.view==='assessments'?assessmentsView():classView()}</main></div></div>`;
  app.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>navigate(b.dataset.view));
  app.querySelector('[data-action="logout"]').onclick=logout;
  app.querySelector('#student')?.addEventListener('change',async e=>{state.studentId=Number(e.target.value);try{await refresh();render();}catch(e){showError(e);}});
  app.querySelectorAll('[data-class]').forEach(b=>b.onclick=()=>openLesson(b.dataset.class,Number(b.dataset.day||state.day)));
  app.querySelector('#class-select')?.addEventListener('change',e=>openLesson(e.target.value,state.day));
  app.querySelector('#day-select')?.addEventListener('change',e=>openLesson(state.classId,Number(e.target.value)));
  app.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>openLesson(state.classId,state.day+Number(b.dataset.step)));
  app.querySelector('#save-lesson')?.addEventListener('click',saveLesson);
  app.querySelectorAll('[data-verify]').forEach(b=>b.onclick=()=>verify(b.dataset.verify));
}
function dashboard(){
  const s=state.summary;if(!s)return '';
  return `<span class="eyebrow">CINCO MATERIAS · 170 DÍAS</span><h1>Tu avance, en conjunto</h1><p class="muted">Un día cuenta cuando sus cinco materias están completadas.</p><div class="stats"><div class="stat card"><span class="muted">Días completos</span><strong>${s.completed}/170</strong></div><div class="stat card"><span class="muted">Avance global</span><strong>${Math.round(s.completed/170*100)}%</strong></div><div class="stat card"><span class="muted">Días verificados</span><strong>${s.verified}/170</strong></div><div class="stat card"><span class="muted">Lecciones por revisar</span><strong>${s.byClass.reduce((n,c)=>n+c.pending,0)}</strong></div></div><h2>Progreso por materia</h2><div class="subject-grid">${state.course.classes.map(c=>{const p=s.byClass.find(x=>x.id===c.id);return `<article class="card subject-card"><h3>${esc(c.name)}</h3><div class="subject-count"><strong>${p.completed}</strong><span class="muted"> / 170 completadas</span></div><progress value="${p.completed}" max="170" aria-label="Avance ${esc(c.name)}"></progress><p class="hint">${p.verified} verificadas · ${p.pending} por revisar · ${p.returned} devueltas</p><button class="secondary" data-class="${c.id}">Abrir materia</button></article>`;}).join('')}</div>`;
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
async function navigate(view){state.view=view;state.message='';if(view==='class')return openLesson(state.classId,state.day);render();if(view==='assessments'){const session=state;try{await Promise.all(state.course.classes.map(async c=>{if(!session.cache[c.id])session.cache[c.id]=await api('/api/course/'+encodeURIComponent(c.id));}));if(state===session&&state.view===view)render();}catch(e){if(state===session&&state.view===view)showError(e);}}}
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
(async()=>{try{const d=await api('/api/me');state.user=d.user;if(d.user)await load();else login();}catch(e){login(e.message);}})();
