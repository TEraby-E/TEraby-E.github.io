'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const storage = require('../study/storage.js');
const library = JSON.parse(fs.readFileSync(path.join(__dirname, '../study/data/library.json'), 'utf8'));
const firstSubject = library.subjects[0];
const originalTask = firstSubject.chapters[0].tasks[0];

function fixture(initial = storage.helpers.initialRecord('2026-11-07'), { offline = false } = {}) {
  let record = structuredClone(initial);
  const store = storage.createStore({
    now: () => new Date('2026-11-07T04:00:00Z'),
    fetch: async () => {
      if (offline) throw new Error('offline');
      return { ok: true, json: async () => structuredClone(library) };
    },
  }, async operation => {
    const outcome = operation(structuredClone(record));
    if (outcome.record) record = outcome.record;
    return outcome.result;
  });
  return { store, record: () => structuredClone(record) };
}

async function putPlan(store, catalogue) {
  const state = await store.request('/api/state');
  return store.request('/api/plan', {
    method: 'PUT', body: JSON.stringify({ date: state.date, revision: state.revision, catalogue }),
  });
}

test('the downloadable default plan matches the built-in catalogue and its metadata', () => {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, '../study/plans/default-plan.json'), 'utf8'));
  const catalogue = storage.plan.unpack(file);
  assert.deepEqual(catalogue, library);
  assert.equal(storage.plan.entries(catalogue).length, 1587);
  assert.deepEqual(storage.plan.unpack(storage.plan.pack(catalogue)), library);
});

test('a saved plan works for reading, saving and opening history without fetching the built-in catalogue', async () => {
  const initial = storage.helpers.initialRecord('2026-11-07');
  const index = storage.helpers.libraryIndex(library);
  let record = storage.helpers.saveRecord(initial, {
    date: initial.current.date, revision: initial.revision,
    assignments: [{ task_id: originalTask.id, done: true, actual_minutes: 17 }],
  }, index);
  record.plan_library = library;
  record.archives = [{ date: '2026-11-06', assignments: structuredClone(record.current.assignments) }];
  let transactions = 0;
  const store = storage.createStore({
    now: () => new Date('2026-11-07T04:00:00Z'),
    fetch: async () => { throw new Error('An existing plan should not fetch the default catalogue.'); },
  }, async operation => {
    transactions += 1;
    const outcome = operation(structuredClone(record));
    if (outcome.record) record = outcome.record;
    return outcome.result;
  });
  const day = await store.request('/api/day');
  assert.equal(transactions, 1);
  assert.equal(day.state.assignments[0].actual_minutes, 17);
  assert.equal(day.library.subjects[0].chapters[0].tasks[0].id, originalTask.id);
  const saved = await store.request('/api/state', { method: 'PUT', body: JSON.stringify(day.state) });
  assert.equal(saved.assignments[0].actual_minutes, 17);
  const history = await store.request('/api/history/2026-11-06');
  assert.equal(history.assignments[0].actual_minutes, 17);
  assert.equal(transactions, 3);
});

test('a built-in plan refresh retires removed tasks and keeps legacy tasks, snapshots and settings', async () => {
  const previous = structuredClone(library);
  previous.version = 1;
  const removed = previous.metadata.retired_tasks.find(task => task.subject_id === 'os');
  previous.metadata.retired_tasks = previous.metadata.retired_tasks.filter(task => task.id !== removed.id);
  const os = previous.subjects.find(subject => subject.id === 'os');
  os.chapters.push({ id: 'old-os-round-two', title: '旧的强化章节', phase: '强化', tasks: [{ ...removed, title: '旧任务' }] });
  previous.subjects[0].chapters.push({ id: 'legacy-plan', title: '原有计划', phase: '', tasks: [{ id: 'custom-kept', title: '旧自定义任务' }] });
  const initial = storage.helpers.initialRecord('2026-11-07');
  const saved = storage.helpers.saveRecord(initial, {
    date: initial.current.date, revision: initial.revision,
    assignments: [{ task_id: removed.id, done: true, actual_minutes: 21 }],
    library_completed_ids: [removed.id], subject_phases: { os: '强化' },
  }, storage.helpers.libraryIndex(previous));
  saved.plan_library = previous;
  const { store, record } = fixture(saved);
  const day = await store.request('/api/day');
  assert.equal(day.library.version, library.version);
  assert(!storage.plan.entries(day.library).some(task => task.id === removed.id));
  assert(day.library.metadata.retired_tasks.some(task => task.id === removed.id));
  assert(storage.plan.entries(day.library).some(task => task.id === 'custom-kept'));
  assert.deepEqual(day.state.assignments, saved.current.assignments);
  assert.deepEqual(day.state.library_completed_ids, [removed.id]);
  assert.equal(day.state.subject_phases.os, '');
  assert.equal(record().revision, saved.revision + 1);
  await store.request('/api/day');
  assert.equal(record().revision, saved.revision + 1);
  const explicit = fixture({ ...saved, plan_customized: true });
  assert.equal((await explicit.store.request('/api/day')).library.version, 1);
  assert.equal(explicit.record().revision, saved.revision);
});

test('a failed built-in catalogue refresh leaves the saved offline plan usable', async () => {
  const record = { ...storage.helpers.initialRecord('2026-11-07'), plan_library: { ...library, version: 1 } };
  const store = storage.createStore({
    now: () => new Date('2026-11-07T04:00:00Z'),
    fetch: async () => { throw new Error('offline'); },
  }, async operation => operation(structuredClone(record)).result);
  const day = await store.request('/api/day');
  assert.equal(day.library.version, 1);
  assert.equal(day.state.revision, record.revision);
});

test('legacy custom check-ins and saved plans migrate once alongside all original subjects', async () => {
  const custom = { task_id: 'custom-old-checkin', subject_id: 'english', title: '旧自定义打卡', detail: '原记录', done: true, actual_minutes: 15 };
  const initial = { ...storage.helpers.initialRecord('2026-11-07'), plan_tasks: [{ task_id: 'custom-old-plan', subject_id: 'ds', title: '旧计划任务', detail: '保留内容' }] };
  initial.current.assignments = [custom];
  const { store, record } = fixture(initial);
  const catalogue = await store.request('/api/library');
  assert.equal(storage.plan.entries(catalogue).length, library.metadata.task_count + 2);
  assert.deepEqual(record().current.assignments, [custom]);
  const revision = record().revision;
  await store.request('/api/library');
  assert.equal(record().revision, revision);
  const v1 = { format: 'study-journal-plan', version: 1, tasks: initial.plan_tasks };
  assert.equal(storage.plan.entries(storage.plan.unpack(v1, library)).length, library.metadata.task_count + 1);
});

test('editing and moving a plan task keeps its ID and all existing check-in snapshots', async () => {
  const index = storage.helpers.libraryIndex(library);
  const initial = storage.helpers.saveRecord(storage.helpers.initialRecord('2026-11-07'), {
    date: '2026-11-07', revision: 1, assignments: [{ task_id: originalTask.id, done: true, actual_minutes: 31 }],
  }, index);
  const { store, record } = fixture(initial);
  let catalogue = await store.request('/api/library');
  const entry = storage.plan.entries(catalogue).find(task => task.task_id === originalTask.id);
  catalogue = storage.plan.update(catalogue, { ...entry, title: '改后的任务', detail: '改后的内容', estimated_minutes: 42, subject_id: 'calculus', chapter_id: '' });
  let state = await putPlan(store, catalogue);
  assert.equal(state.assignments[0].title, originalTask.title);
  assert.equal(state.assignments[0].subject_id, 'english');
  assert.equal(state.assignments[0].actual_minutes, 31);
  const moved = storage.plan.entries(await store.request('/api/library')).find(task => task.task_id === originalTask.id);
  assert.equal(moved.subject_id, 'calculus');
  assert.equal(moved.estimated_minutes, 42);
  state = await store.request('/api/state', { method: 'PUT', body: JSON.stringify(state) });
  assert.equal(state.assignments[0].title, originalTask.title);
  assert.equal(state.assignments[0].actual_minutes, 31);

  const savedBackup = await store.exportBackup();
  const target = fixture();
  await target.store.importBackup(savedBackup, { replace: true, revision: 1 });
  assert.deepEqual(target.record().plan_library, record().plan_library);
  assert.deepEqual(target.record().current, record().current);
});

test('removing tasks keeps historical IDs valid and rejects stale or malformed plan writes', async () => {
  const index = storage.helpers.libraryIndex(library);
  const initial = storage.helpers.saveRecord(storage.helpers.initialRecord('2026-11-07'), {
    date: '2026-11-07', revision: 1, assignments: [{ task_id: originalTask.id, done: true, actual_minutes: 20 }],
  }, index);
  const { store, record } = fixture(initial);
  const catalogue = storage.plan.remove(await store.request('/api/library'), originalTask.id);
  const before = await store.request('/api/state');
  let state = await putPlan(store, catalogue);
  assert(record().plan_library.metadata.retired_tasks.some(task => task.id === originalTask.id));
  state = await store.request('/api/state', { method: 'PUT', body: JSON.stringify(state) });
  assert.equal(state.assignments[0].actual_minutes, 20);
  const stable = record();
  await assert.rejects(store.request('/api/plan', { method: 'PUT', body: JSON.stringify({ date: before.date, revision: before.revision, catalogue }) }), error => error.status === 409);
  const invalid = structuredClone(catalogue);
  invalid.subjects[1].chapters[0].tasks.push(structuredClone(invalid.subjects[0].chapters[0].tasks[0]));
  await assert.rejects(putPlan(store, invalid));
  assert.deepEqual(record(), stable);
});

test('an explicit plan mode edit updates the current task and preserves past check-ins', async () => {
  const id = originalTask.id;
  const index = storage.helpers.libraryIndex(library);
  const initial = storage.helpers.saveRecord(storage.helpers.initialRecord('2026-11-07'), {
    date: '2026-11-07', revision: 1,
    assignments: [{ task_id: id, task_mode: 'single-day', done: true, actual_minutes: 18 }],
    task_modes: { [id]: 'single-day' },
  }, index);
  initial.archives = [{ ...structuredClone(initial.current), date: '2026-11-06' }];
  const { store, record } = fixture(initial);
  const catalogue = await store.request('/api/library');
  const state = await store.request('/api/state');
  const entry = storage.plan.entries(catalogue).find(task => task.task_id === id);
  const updated = storage.plan.update(catalogue, { ...entry, task_mode: 'multi-day' });
  const saved = await store.request('/api/plan', {
    method: 'PUT', body: JSON.stringify({ date: state.date, revision: state.revision, catalogue: updated, mode_task_id: id }),
  });
  assert.deepEqual(saved.assignments, [{ ...state.assignments[0], task_mode: 'multi-day' }]);
  assert.equal(saved.task_modes[id], undefined);
  assert.deepEqual(record().archives, initial.archives);
  const exported = storage.plan.pack(await store.request('/api/library'));
  assert.equal(storage.plan.entries(storage.plan.unpack(exported)).find(task => task.task_id === id).task_mode, 'multi-day');
});

test('an empty custom chapter survives save, export and merge, and keeps its ID when renamed', async () => {
  const chapter = { id: 'custom-chapter-review', subject_id: firstSubject.id, title: '  我的复习  ', phase: firstSubject.chapters[0].phase };
  const { store } = fixture();
  const catalogue = storage.plan.updateChapter(await store.request('/api/library'), chapter);
  const findChapter = plan => plan.subjects[0].chapters.find(item => item.id === chapter.id);
  assert.deepEqual(findChapter(catalogue), { id: chapter.id, title: '我的复习', phase: chapter.phase, tasks: [] });
  assert.throws(() => storage.plan.updateChapter(catalogue, { ...chapter, phase: '不存在的阶段' }), /已有的学习阶段/);
  assert.throws(() => storage.plan.updateChapter(catalogue, { ...chapter, id: firstSubject.chapters[0].id }), /自定义章节/);
  assert.throws(() => storage.plan.updateChapter(catalogue, { ...chapter, id: 'custom-chapter-duplicate' }), /同名章节/);

  await putPlan(store, catalogue);
  const exported = storage.plan.pack(await store.request('/api/library'));
  const imported = storage.plan.merge(library, storage.plan.unpack(exported));
  assert.deepEqual(findChapter(imported), findChapter(catalogue));
  const filled = storage.plan.update(imported, { task_id: 'custom-review', subject_id: chapter.subject_id, chapter_id: chapter.id, title: '复习笔记' });
  const renamed = storage.plan.updateChapter(filled, { id: chapter.id, subject_id: chapter.subject_id, title: '复习章节' });
  const task = storage.plan.entries(renamed).find(entry => entry.task_id === 'custom-review');
  assert.equal(task.chapter_id, chapter.id);
  assert.equal(task.chapter_title, '复习章节');
  assert.equal(task.phase, chapter.phase);
});

test('complete JSON restores the entire journal offline after deleting a subject', async () => {
  const subject = { id: 'custom-subject-review', name: '算法复习' };
  const chapter = { id: 'custom-chapter-review', subject_id: subject.id, title: '图搜索', phase: '' };
  const id = 'custom-review-task';
  let catalogue = storage.plan.updateSubject(library, subject);
  catalogue = storage.plan.updateChapter(catalogue, chapter);
  catalogue = storage.plan.update(catalogue, { task_id: id, subject_id: subject.id, chapter_id: chapter.id, title: '最短路', task_mode: 'multi-day' });
  const index = storage.helpers.libraryIndex(catalogue);
  const initial = storage.helpers.saveRecord({ ...storage.helpers.initialRecord('2026-11-07'), plan_library: catalogue, plan_customized: true }, {
    date: '2026-11-07', revision: 1,
    assignments: [{ task_id: id, done: true, actual_minutes: 20, checkin_segments: [8, 12] }, { task_id: originalTask.id, done: true, actual_minutes: 9 }],
    library_completed_ids: [id], library_reopened_ids: [], task_modes: { [id]: 'multi-day' }, subject_phases: { [subject.id]: '' },
  }, index);
  const archived = storage.helpers.archiveRecord(initial, { date: '2026-11-07', revision: initial.revision }, index);
  initial.archives = archived.archives.map(day => ({ ...day, date: '2026-11-06' }));
  initial.current.assignments.reverse();
  const { store, record } = fixture(initial, { offline: true });
  const backup = await store.exportBackup();
  assert(storage.backup.isFull(backup));
  const deleted = await store.request('/api/plan', { method: 'DELETE', body: JSON.stringify({ date: initial.current.date, revision: initial.revision, subject_id: subject.id }) });
  assert.deepEqual(deleted.assignments.map(task => task.task_id), [originalTask.id]);
  assert.deepEqual(record().archives[0].assignments.map(task => task.task_id), [originalTask.id]);
  assert(!record().plan_library.subjects.some(item => item.id === subject.id));
  assert(!Object.hasOwn(deleted.task_modes, id));
  assert(!Object.hasOwn(deleted.subject_phases, subject.id));
  const restored = await store.importBackup(backup, { replace: true, revision: deleted.revision });
  const { exported_at: _, ...snapshot } = backup;
  const { exported_at: __, ...roundTrip } = await store.exportBackup();
  assert.deepEqual(roundTrip, snapshot);
  assert.deepEqual(restored.assignments.map(task => task.task_id), [id, originalTask.id]);
  assert.equal((await store.request(`/api/history?subject_id=${subject.id}`)).total, 2);
});

test('a full backup preserves an intentionally empty plan when replacing the default plan', async () => {
  const catalogue = { subjects: [] };
  const source = fixture({ ...storage.helpers.initialRecord('2026-11-07'), plan_library: catalogue, plan_customized: true }, { offline: true });
  const target = fixture({ ...storage.helpers.initialRecord('2026-11-07'), plan_library: library }, { offline: true });
  const backup = await source.store.exportBackup();
  await target.store.importBackup(backup, { replace: true, revision: 1 });
  assert.deepEqual(await target.store.request('/api/library'), catalogue);
  assert.deepEqual(target.record().current.assignments, []);
});

test('restoring an earlier backup preserves its dated snapshot and brings unfinished work into today', async () => {
  const date = '2026-11-06';
  const index = storage.helpers.libraryIndex(library);
  const initial = storage.helpers.saveRecord({ ...storage.helpers.initialRecord(date), plan_library: library }, {
    date, revision: 1, assignments: [{ task_id: originalTask.id, done: false }],
  }, index);
  const source = fixture(initial, { offline: true });
  const target = fixture(undefined, { offline: true });
  const restored = await target.store.importBackup(await source.store.exportBackup(), { replace: true, revision: 1 });
  assert.equal(restored.date, '2026-11-07');
  assert.deepEqual(restored.assignments, initial.current.assignments);
  assert.deepEqual(target.record().archives, [initial.current]);
  assert.deepEqual(restored.history, []);
});

test('deleting a plan chapter or task removes its check-ins and time without deleting unrelated records', async () => {
  const chapter = { id: 'custom-chapter-delete', subject_id: firstSubject.id, title: '准备删除' };
  const taskId = 'custom-task-in-chapter';
  let catalogue = storage.plan.updateChapter(library, chapter);
  catalogue = storage.plan.update(catalogue, { task_id: taskId, subject_id: chapter.subject_id, chapter_id: chapter.id, title: '准备删除的任务' });
  const target = catalogue.subjects[0].chapters.find(item => item.id === chapter.id);
  target.tasks[0].estimate_group = originalTask.estimate_group || originalTask.id;
  const initial = storage.helpers.initialRecord('2026-11-07');
  const saved = storage.helpers.saveRecord(initial, {
    date: initial.current.date, revision: initial.revision,
    assignments: [
      { task_id: taskId, done: true, actual_minutes: 12 },
      { task_id: originalTask.id, done: true, actual_minutes: 25 },
    ],
    library_completed_ids: [taskId, originalTask.id], library_reopened_ids: [taskId],
    task_modes: { [taskId]: 'multi-day', [originalTask.id]: 'single-day' },
  }, storage.helpers.libraryIndex(catalogue));
  const [removed, kept] = saved.current.assignments;
  const frozenOther = { phase: '', totalMinutes: 100, completedMinutes: 25, unknown: 0, percent: 25 };
  saved.plan_library = catalogue;
  saved.plan_tasks = [{ task_id: taskId, subject_id: chapter.subject_id, title: removed.title, detail: '' }];
  saved.archives = [
    { date: '2026-11-05', assignments: [removed] },
    { date: '2026-11-06', assignments: [removed, kept], subject_stage_progress: { [chapter.subject_id]: frozenOther, calculus: frozenOther } },
  ];
  const { store, record } = fixture(saved);
  const request = (selection, revision = saved.revision) => store.request('/api/plan', {
    method: 'DELETE', body: JSON.stringify({ date: initial.current.date, revision, ...selection }),
  });
  const selection = { chapter_id: chapter.id, subject_id: chapter.subject_id };
  await assert.rejects(request(selection, saved.revision - 1), error => error.status === 409);
  await assert.rejects(request({ ...selection, chapter_id: firstSubject.chapters[0].id }), /自定义章节/);
  assert.deepEqual(record(), saved);

  const after = await request(selection);
  assert.equal(after.revision, saved.revision + 1);
  assert.deepEqual(after.assignments, [kept]);
  assert.equal(after.task_progress[taskId], undefined);
  assert.equal(after.task_progress[originalTask.id].actual_minutes, 50);
  assert.deepEqual(after.library_completed_ids, [originalTask.id]);
  assert.deepEqual(after.library_reopened_ids, []);
  assert.deepEqual(after.task_modes, { [originalTask.id]: 'single-day' });
  assert.deepEqual(record().archives.map(day => day.date), ['2026-11-06']);
  assert.deepEqual(record().archives[0].subject_stage_progress, { calculus: frozenOther });
  const history = await store.request('/api/history/2026-11-06');
  assert.deepEqual(history.assignments, [kept]);
  assert.deepEqual(history.subject_stage_progress.calculus, frozenOther);
  assert(history.subject_stage_progress[chapter.subject_id]);
  assert(!JSON.stringify(await store.exportBackup()).includes(taskId));
  assert(!record().plan_library.subjects[0].chapters.some(item => item.id === chapter.id));

  await request({ task_id: originalTask.id }, after.revision);
  assert.deepEqual(record().current.assignments, []);
  assert.deepEqual(record().archives, []);
  assert(!storage.plan.entries(await store.request('/api/library')).some(entry => entry.task_id === originalTask.id));
  assert(!record().plan_library.metadata.retired_tasks.some(task => task.id === originalTask.id));
});

test('advanced history filters real check-in fields and paginates dates without writing records', async () => {
  const assignment = (task_id, fields = {}) => ({
    task_id, subject_id: 'ds', chapter_id: 'custom-chapter-review', chapter_title: '递归练习',
    title: 'DFS 复习', detail: '回顾树遍历', task_mode: 'single-day', done: true, ...fields,
  });
  const snapshot = {
    ...storage.helpers.initialRecord('2026-11-07'),
    current: { date: '2026-11-07', assignments: [assignment('pending-today', { done: false, chapter_id: 'today', chapter_title: '今天的章节' })] },
    archives: [
      { date: '2026-11-05', assignments: [assignment('missing-minutes', { task_mode: 'multi-day', remarks: '明天重做', actual_minutes: null })] },
      { date: '2026-11-06', assignments: [
        assignment('shared-short', { actual_minutes: 12, estimate_group: 'shared' }),
        assignment('shared-long', { actual_minutes: 18, estimate_group: 'shared' }),
        assignment('zero-minutes', { actual_minutes: 0, subject_id: 'os', chapter_id: 'legacy-os', chapter_title: '已下架章节' }),
        assignment('pending-archive', { done: false }),
      ] },
      { date: '2026-11-04', assignments: [assignment('no-checkins', { done: false })] },
      { date: '2026-11-07', assignments: [assignment('duplicate-today')] },
    ],
    task_modes: { 'pending-today': 'multi-day' },
  };
  const store = storage.createStore({
    fetch: async () => { throw new Error('History search should use the record without loading the catalogue'); },
  }, async (operation, readOnly) => {
    assert.equal(readOnly, true);
    const outcome = operation(structuredClone(snapshot));
    assert.equal(outcome.record, undefined);
    return outcome.result;
  });

  const firstPage = await store.request('/api/history?limit=1');
  assert.equal(firstPage.total, 3);
  assert.deepEqual(firstPage.dates.map(day => [day.date, day.total, day.completed, day.assignments[0].task_id]), [
    ['2026-11-07', 1, 0, 'pending-today'],
  ]);
  assert(firstPage.chapters.some(chapter => chapter.title === '已下架章节'));
  const nextPage = await store.request('/api/history?limit=1&offset=1&status=done');
  assert.equal(nextPage.total, 2);
  assert.equal(nextPage.dates[0].date, '2026-11-05');
  const combined = await store.request('/api/history?subject_id=ds&chapter_id=custom-chapter-review&status=done&task_mode=multi-day&actual=unrecorded&q=dfs+重做');
  assert.deepEqual(combined.dates.flatMap(day => day.assignments.map(task => task.task_id)), ['missing-minutes']);
  assert(combined.chapters.some(chapter => chapter.id === 'today'));
  const recorded = await store.request('/api/history?actual=recorded');
  assert.deepEqual(recorded.dates.map(day => [day.total, day.completed, day.actual_minutes]), [[3, 3, 18]]);
  assert(recorded.dates[0].assignments.some(task => task.task_id === 'zero-minutes'));
  const pending = await store.request('/api/history?status=pending&task_mode=multi-day');
  assert.deepEqual(pending.dates.flatMap(day => day.assignments.map(task => task.task_id)), ['pending-today']);
  await assert.rejects(store.request('/api/history?subject_id=unknown'), /有效的学科/);
  await assert.rejects(store.request('/api/history?limit=101'), /分页参数/);
});
