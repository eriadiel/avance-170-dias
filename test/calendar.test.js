const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function runtime(){
 const context=vm.createContext({document:{getElementById:()=>({}),addEventListener:()=>{}},Intl,Date,console});
 vm.runInContext(source.slice(0,source.lastIndexOf("(async()=>{try{const d=await api('/api/me')")),context);
 return code=>vm.runInContext(code,context);
}
test('independent calendars, holidays, historical dates and student/tutor parity',()=>{
 const run=runtime(),students=[{id:21,email:'eriandres',name:'Eriandres'},{id:22,email:'emalucia',name:'Emalucia'}];
 run('state.user={email:"other",role:"student"}');
 const old=Array.from(run('schoolCalendar()'));
 for(const student of students){
  const anchor=student.email==='eriandres'?30:41;
  run('state.user='+JSON.stringify({...student,role:'student'}));
  const dates=Array.from(run('schoolCalendar()'));
  assert.equal(dates.length,170);assert.equal(new Set(dates).size,170);
  assert.deepEqual(dates.slice(0,anchor-1),old.slice(0,anchor-1));
  assert.equal(dates[anchor-1],'2026-11-23');assert.equal(dates[anchor],'2026-11-24');
  assert.equal(run('scheduledDay("2026-11-23")'),anchor);
  assert.ok(dates.every((d,i)=>!i||d>dates[i-1]));
  const holidays=Array.from(run('schoolHolidays'));
  assert.ok(dates.every(d=>![0,6].includes(new Date(d+'T12:00:00Z').getUTCDay())&&!holidays.includes(d)));
  assert.match(run('calendarGoal("2026-11-23")'),new RegExp('Hoy corresponde el día '+anchor+' de 170'));
  assert.match(run('calendarGoal("2026-11-23")'),new RegExp('<strong>'+(171-anchor)+'</strong>'));
  for(const tutor of ['eri','zenia']){
   run('state.user='+JSON.stringify({email:tutor,role:'tutor'})+';state.students='+JSON.stringify(students)+';state.studentId='+student.id);
   assert.deepEqual(Array.from(run('schoolCalendar()')),dates);
  }
  console.log(student.email+' lesson 170: '+dates[169]);
 }
});
test('assessments follow the selected calendar and retain lesson content',()=>{
 const run=runtime();
 run('state.user={role:"tutor",email:"eri"};state.students=[{id:21,email:"eriandres"},{id:22,email:"emalucia"}];state.studentId=21;state.course={classes:[{id:"science",name:"Science"}]};state.cache={science:{days:[{day:30,sections:[{heading:"Materials Needed",text:"Quiz 6"}]},{day:31,sections:[{heading:"Materials Needed",text:"Test 2"}]}]}};state.progress=[{class_id:"science",day:30,completed:true,tutor_status:"verified"}]');
 const before=run('JSON.stringify(state.progress)');
 assert.equal(run('assessmentEvents()["2026-11-23"][0].day'),30);
 assert.equal(run('assessmentEvents()["2026-11-24"][0].items[0]'),'Test 2');
 run('state.studentId=22');
 assert.equal(run('dailyMode()'),true);
 assert.equal(run('scheduledDay("2026-11-23")'),41);
 run('state.studentId=21');
 assert.equal(run('assessmentEvents()["2026-11-23"][0].items[0]'),'Quiz 6');
 assert.equal(run('JSON.stringify(state.progress)'),before);
});
