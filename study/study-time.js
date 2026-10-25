/* Shared estimate calculations for the daily list, archives and PNG exports. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyTime = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const indexes = new WeakMap();
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

  function getEstimate(task = {}, canonical = null) {
    const explicit = Object.hasOwn(task, 'estimated_minutes');
    const minutes = explicit ? (valid(task.estimated_minutes) ? rounded(task.estimated_minutes) : null) : (valid(canonical?.estimated_minutes) ? rounded(canonical.estimated_minutes) : null);
    const source = String((explicit ? task.estimated_source : canonical?.estimated_source) || task.estimated_source || canonical?.estimated_source || '');
    const groupValue = Object.hasOwn(task, 'estimate_group') ? task.estimate_group : canonical?.estimate_group;
    const group = typeof groupValue === 'string' && groupValue ? groupValue : null;
    const video = /视频时长/.test(source);
    const wholeTask = /分段|整项/.test(source);
    const label = minutes === null ? '预计用时待补充' : `${video ? '视频时长' : wholeTask ? '整项预计' : '预计'}${formatMinutes(minutes)}`;
    return { minutes, label, source, group };
  }

  function getActual(task = {}) {
    const minutes = task.done === true && valid(task.actual_minutes) ? rounded(task.actual_minutes) : null;
    const label = task.done !== true ? '实际待完成' : minutes === null ? '实际未记录' : `实际${formatMinutes(minutes)}`;
    return { minutes, label, recorded: minutes !== null };
  }

  function comparisonLabel(task = {}, canonical = null) {
    return `${getEstimate(task, canonical).label} / ${getActual(task).label}`;
  }

  function taskIndex(library) {
    if (!library || typeof library !== 'object') return new Map();
    if (indexes.has(library)) return indexes.get(library);
    const subjects = Array.isArray(library) ? library : library.subjects || [];
    const index = new Map();
    for (const subject of subjects) for (const chapter of subject.chapters || []) for (const task of chapter.tasks || []) index.set(task.id, task);
    for (const task of library.metadata?.retired_tasks || []) if (!index.has(task.id)) index.set(task.id, task);
    indexes.set(library, index);
    return index;
  }

  function summarize(assignments = [], library = null) {
    const index = taskIndex(library);
    const groups = new Map();
    let serial = 0;
    for (const task of assignments) {
      const estimate = getEstimate(task, index.get(task.task_id || task.id));
      const key = estimate.group ? `shared:${estimate.group}` : `task:${task.task_id || task.id || serial++}`;
      let group = groups.get(key);
      if (!group) { group = { minutes: null, done: true, tasks: 0, completed: 0, actual: null }; groups.set(key, group); }
      group.tasks += 1;
      group.done = group.done && task.done === true;
      // Copies of a complete paper in different subjects share one estimate.
      // Use the largest snapshot if older copies disagree rather than sum it.
      if (estimate.minutes !== null) group.minutes = Math.max(group.minutes ?? 0, estimate.minutes);
      if (task.done === true) group.completed += 1;
      const actual = getActual(task);
      if (actual.minutes !== null) group.actual = Math.max(group.actual ?? 0, actual.minutes);
    }
    let minutes = 0, completedMinutes = 0, unknown = 0, knownGroups = 0;
    let actualMinutes = 0, actualUnknown = 0, actualKnown = 0, actualGroups = 0;
    for (const group of groups.values()) {
      if (group.completed) {
        if (group.actual === null) actualUnknown += group.completed;
        else { actualMinutes += group.actual; actualKnown += group.completed; actualGroups += 1; }
      }
      if (group.minutes === null) { unknown += group.tasks; continue; }
      knownGroups += 1;
      minutes += group.minutes;
      if (group.done) completedMinutes += group.minutes;
    }
    minutes = rounded(minutes);
    completedMinutes = rounded(completedMinutes);
    return { minutes, unknown, known: assignments.length - unknown, completedMinutes, remainingMinutes: rounded(minutes - completedMinutes), groups: knownGroups,
      actualMinutes: rounded(actualMinutes), actualUnknown, actualKnown, actualGroups };
  }

  return Object.freeze({ getEstimate, getActual, comparisonLabel, summarize, formatMinutes, validMinutes: valid });
});
