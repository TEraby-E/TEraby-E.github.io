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

test('the downloadable default plan preserves every original task and its metadata', () => {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, '../study/plans/default-plan.json'), 'utf8'));
  const catalogue = storage.plan.unpack(file);
  assert.deepEqual(catalogue, library);
  assert.equal(storage.plan.entries(catalogue).length, 2686);
  assert.deepEqual(storage.plan.unpack(storage.plan.pack(catalogue)), library);
});

test('opening an existing day uses its saved catalogue and check-ins in one read', async () => {
  const initial = storage.helpers.initialRecord('2026-11-07');
  const index = storage.helpers.libraryIndex(library);
  const record = storage.helpers.saveRecord(initial, {
    date: initial.current.date, revision: initial.revision,
    assignments: [{ task_id: originalTask.id, done: true, actual_minutes: 17 }],
  }, index);
  record.plan_library = library;
  let transactions = 0;
  const store = storage.createStore({
    now: () => new Date('2026-11-07T04:00:00Z'),
    fetch: async () => { throw new Error('An existing plan should not fetch the default catalogue.'); },
  }, async operation => {
    transactions += 1;
    return operation(structuredClone(record)).result;
  });
  const day = await store.request('/api/day');
  assert.equal(transactions, 1);
  assert.equal(day.state.assignments[0].actual_minutes, 17);
  assert.equal(day.library.subjects[0].chapters[0].tasks[0].id, originalTask.id);
});

test('legacy custom check-ins and saved plans migrate once alongside all original subjects', async () => {
  const custom = { task_id: 'custom-old-checkin', subject_id: 'english', title: '旧自定义打卡', detail: '原记录', done: true, actual_minutes: 15 };
  const initial = { ...storage.helpers.initialRecord('2026-11-07'), plan_tasks: [{ task_id: 'custom-old-plan', subject_id: 'ds', title: '旧计划任务', detail: '保留内容' }] };
  initial.current.assignments = [custom];
  const { store, record } = fixture(initial);
  const catalogue = await store.request('/api/library');
  assert.equal(storage.plan.entries(catalogue).length, 2688);
  assert.deepEqual(record().current.assignments, [custom]);
  const revision = record().revision;
  await store.request('/api/library');
  assert.equal(record().revision, revision);
  const v1 = { format: 'study-journal-plan', version: 1, tasks: initial.plan_tasks };
  assert.equal(storage.plan.entries(storage.plan.unpack(v1, library)).length, 2687);
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
