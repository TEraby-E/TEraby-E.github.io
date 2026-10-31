/* Shared actual-time calculations for daily records, archives and PNG exports. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyTime = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const valid = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 525600;
  const rounded = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

  function formatMinutes(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '待补充';
    const minutes = rounded(value);
    const hours = Math.floor(minutes / 60);
    const rest = rounded(minutes - hours * 60);
    if (!hours) return `${rest}分钟`;
    return `${hours}小时${rest ? `${rest}分钟` : ''}`;
  }

  function getActual(task = {}) {
    const minutes = task.done === true && valid(task.actual_minutes) ? rounded(task.actual_minutes) : null;
    const label = task.done !== true ? '实际待完成' : minutes === null ? '实际未记录' : `实际${formatMinutes(minutes)}`;
    return { minutes, label, recorded: minutes !== null };
  }

  function summarizeActual(assignments = []) {
    const groups = new Map();
    let serial = 0;
    for (const task of assignments) {
      const key = task.estimate_group ? `shared:${task.estimate_group}` : `task:${task.task_id || task.id || serial++}`;
      let group = groups.get(key);
      if (!group) { group = { completed: 0, actual: null }; groups.set(key, group); }
      if (task.done === true) group.completed += 1;
      const actual = getActual(task);
      if (actual.minutes !== null) group.actual = Math.max(group.actual ?? 0, actual.minutes);
    }
    let actualMinutes = 0, actualUnknown = 0, actualKnown = 0, actualGroups = 0;
    for (const group of groups.values()) {
      if (!group.completed) continue;
      if (group.actual === null) actualUnknown += group.completed;
      else { actualMinutes += group.actual; actualKnown += group.completed; actualGroups += 1; }
    }
    return { actualMinutes: rounded(actualMinutes), actualUnknown, actualKnown, actualGroups };
  }

  return Object.freeze({ getActual, summarizeActual, formatMinutes, validMinutes: valid });
});
