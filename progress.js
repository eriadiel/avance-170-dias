const CLASS_IDS = Object.freeze(['science', 'english', 'pre-algebra', 'history', 'bible']);
const TOTAL_DAYS = 170;
function validLesson(classId, day) {
  return CLASS_IDS.includes(classId) && Number.isInteger(day) && day >= 1 && day <= TOTAL_DAYS;
}
function summarize(rows) {
  const map = new Map(rows.map(r => [`${r.class_id}:${r.day}`, r]));
  const byClass = CLASS_IDS.map(id => {
    const items = Array.from({length: TOTAL_DAYS}, (_, i) => map.get(`${id}:${i+1}`));
    return { id, completed: items.filter(p => p?.completed).length,
      verified: items.filter(p => p?.completed && p.tutor_status === 'verified').length,
      pending: items.filter(p => p?.completed && p.tutor_status === 'pending').length,
      returned: items.filter(p => p?.tutor_status === 'returned').length };
  });
  const days = Array.from({length: TOTAL_DAYS}, (_, i) => {
    const items = CLASS_IDS.map(id => map.get(`${id}:${i+1}`));
    return { day: i+1, completed: items.every(p => p?.completed === true),
      verified: items.every(p => p?.completed === true && p.tutor_status === 'verified') };
  });
  return { totalDays: TOTAL_DAYS, completed: days.filter(d => d.completed).length,
    verified: days.filter(d => d.verified).length, byClass, days };
}
module.exports = { CLASS_IDS, TOTAL_DAYS, validLesson, summarize };
