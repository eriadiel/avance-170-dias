const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CLASS_IDS,validLesson,summarize}=require('../progress');
test('global day requires every distinct class on the same day',()=>{
 const rows=CLASS_IDS.map(class_id=>({class_id,day:9,completed:true,tutor_status:'pending'}));
 assert.equal(summarize(rows.slice(0,4)).completed,0);
 assert.equal(summarize([...rows.slice(0,4),rows[0]]).completed,0);
 assert.equal(summarize([...rows.slice(0,4),{...rows[4],day:10}]).completed,0);
 assert.equal(summarize(rows).completed,1);
 assert.equal(summarize(rows).verified,0);
 assert.equal(summarize(rows.map(r=>({...r,tutor_status:'verified'}))).verified,1);
 assert.equal(summarize(rows.map(r=>({...r,completed:r.class_id!=='bible'}))).completed,0);
});
test('migration Science alone cannot complete global day',()=>{
 const s=summarize([{class_id:'science',day:1,completed:true,tutor_status:'verified'}]);
 assert.equal(s.completed,0);assert.equal(s.byClass[0].completed,1);assert.equal(s.byClass[0].verified,1);
});
test('strict class and integer day validation',()=>{
 for(const day of [null,'1',0,171,1.5,NaN,Infinity])assert.equal(validLesson('science',day),false);
 assert.equal(validLesson('unknown',1),false);assert.equal(validLesson('bible',170),true);
});
test('all 850 lessons have source provenance and no gaps',()=>{
 const c=JSON.parse(require('zlib').gunzipSync(require('fs').readFileSync(require.resolve('../data/curriculum.json.gz')))).classes;
 assert.deepEqual(c.map(c=>c.id),CLASS_IDS);
 for(const subject of c){assert.equal(subject.days.length,170);assert.match(subject.source.sha256,/^[a-f0-9]{64}$/);
 subject.days.forEach((d,i)=>{assert.equal(d.day,i+1);assert.ok(d.sourceText.length>25);assert.ok(d.sourcePages.length);assert.ok(d.sections.length);assert.ok(!d.sourceText.includes('\ufffd'));});}
});
