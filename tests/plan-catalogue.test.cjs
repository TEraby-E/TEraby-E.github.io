'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const storage = require('../study/storage.js');
const library = JSON.parse(fs.readFileSync(path.join(__dirname, '../study/data/library.json'), 'utf8'));
const firstSubject = library.subjects[0];
const originalTask = firstSubject.chapters[0].tasks[0];

function fixture(initial = storage.helpers.initialRecord('2026-11-07')) {
  let record = structuredClone(initial);
  const store = storage.createStore({
    now: () => new Date('2026-11-07T04:00:00Z'),
    fetch: async () => ({ ok: true, json: async () => structuredClone(library) }),
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
