const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../study/storage.js');
const h = store.helpers;
const library = JSON.parse(fs.readFileSync(path.join(__dirname, '../study/data/library.json'), 'utf8'));
const index = h.libraryIndex(library);
const ids = [...index.keys()];
const first = ids[0];
const second = ids[1];
const task = (task_id = first, done = false) => ({ task_id, done });
const initial = () => h.initialRecord('2026-10-25');
const save = (record, tasks) => h.saveRecord(record, { date: record.current.date, revision: record.revision, assignments: tasks }, index);
const backup = (current, archives = []) => ({ format: 'sjtu-study-checkin-backup', version: 1, current, archives });

test('validates calendar dates without JS date rollover', () => {
  assert.equal(h.validateDate('2024-02-29'), '2024-02-29');
  for (const value of ['2026-02-29', '2026-13-01', '2026-04-31', '2026-1-01', '../x', null, '2026-01-01T12:00:00']) assert.throws(() => h.validateDate(value));
  assert.equal(h.nextDate('2026-12-31'), '2027-01-01');
  assert.equal(h.nextDate('2024-02-28'), '2024-02-29');
});

test('database namespace isolates project paths while sharing index and root URLs', () => {
  assert.equal(h.namespace('https://alice.github.io/study/'), h.namespace('https://alice.github.io/study/index.html?x=1'));
  assert.notEqual(h.namespace('https://alice.github.io/study/'), h.namespace('https://alice.github.io/other/'));
  assert.equal(h.namespace('https://alice.github.io/'), 'sjtu-study-checkin:/');
});

test('normalizes canonical tasks instead of trusting imported content', () => {
  const result = h.normaliseAssignments([{ task_id: first, title: '<script>forged</script>', subject_id: 'cn', done: true }], index);
  assert.equal(result[0].title, index.get(first).task.title);
  assert.equal(result[0].subject_id, 'english');
  assert.equal(result[0].done, true);
  assert.equal(result[0].chapter_title, index.get(first).chapter.title);
});

test('rejects duplicate, missing, oversized and invalid task states', () => {
  for (const list of [[task(), task()], [{ task_id: 'missing' }], [{ task_id: first, done: 'true' }], Array(101).fill(task()), null]) assert.throws(() => h.normaliseAssignments(list, index));
  assert.equal(h.normaliseAssignments([{ task_id: first }], index)[0].done, false);
});

test('keeps the fixed eight-subject order', () => {
  const assignments = library.subjects.map((s) => task(s.chapters.flatMap((c) => c.tasks)[0].id)).reverse();
  assert.deepEqual(h.normaliseAssignments(assignments, index).map((t) => t.subject_id), ['english', 'calculus', 'linear', 'probability', 'ds', 'co', 'os', 'cn']);
});

test('custom tasks keep strict lengths and subject identity', () => {
  const custom = { task_id: 'custom-1', subject_id: 'ds', title: ' 手写题 ', detail: ' 思路 ', done: false };
  assert.equal(h.normaliseAssignments([custom], index)[0].title, '手写题');
  assert.throws(() => h.normaliseAssignments([{ ...custom, title: '' }], index));
  assert.throws(() => h.normaliseAssignments([{ ...custom, title: 'x'.repeat(401) }], index));
  assert.throws(() => h.normaliseAssignments([{ ...custom, detail: 10 }], index));
});

test('save increments revision and rejects stale date/revision without mutating record', () => {
  const record = initial();
  const saved = save(record, [task()]);
  assert.equal(saved.revision, 2);
  assert.equal(record.current.assignments.length, 0);
  for (const payload of [{ date: '2026-10-24', revision: 1 }, { date: '2026-10-25', revision: 0 }, { date: '2026-10-25', revision: '1' }]) assert.throws(() => h.saveRecord(record, { ...payload, assignments: [] }, index), (e) => e.status === 409);
});

test('archive preserves complete day, carries only unfinished tasks, and advances once', () => {
  const saved = save(initial(), [task(first, true), task(second)]);
  const archived = h.archiveRecord(saved, { date: '2026-10-25', revision: 2, carry_pending: true });
  assert.equal(archived.current.date, '2026-10-26');
  assert.deepEqual(archived.current.assignments.map((t) => t.task_id), [second]);
  assert.equal(archived.archives[0].assignments.length, 2);
  assert.equal(archived.revision, 3);
  assert.throws(() => h.archiveRecord(archived, { date: '2026-10-25', revision: 2 }), (e) => e.status === 409);
  const snapshot = h.stateOf(archived);
  assert.deepEqual(snapshot.history, [{ date: '2026-10-25', total: 2, completed: 1 }]);
  assert.ok(snapshot.completed_ids.includes(first));
});

test('empty rest day can be archived; carry option must be boolean', () => {
  assert.equal(h.archiveRecord(initial(), { date: '2026-10-25', revision: 1, carry_pending: false }).archives.length, 1);
  assert.throws(() => h.archiveRecord(initial(), { date: '2026-10-25', revision: 1, carry_pending: 'false' }));
});

test('advancing into an imported future day preserves its tasks without duplicating history', () => {
  const record = save(initial(), [task(first)]);
  record.archives.push({ date: '2026-10-26', assignments: h.normaliseAssignments([task(second, true)], index) });
  const result = h.archiveRecord(record, { date: '2026-10-25', revision: 2, carry_pending: true });
  assert.equal(result.current.date, '2026-10-26');
  assert.equal(result.current.assignments.length, 2);
  assert.equal(result.current.assignments.find((t) => t.task_id === second).done, true);
  assert.deepEqual(result.archives.map((day) => day.date), ['2026-10-25']);
});

test('backup validation rejects duplicate dates and validates all days before mutation', () => {
  const day = { date: '2026-10-25', assignments: [task()] };
  assert.throws(() => h.validateBackup(backup(day, [day]), index));
  assert.throws(() => h.validateBackup(backup(day, [{ date: '2026-10-24', assignments: [{ task_id: 'missing' }] }]), index));
  assert.throws(() => h.validateBackup({ ...backup(day), version: 2 }, index));
  assert.equal(h.validateBackup(backup(day), index).current.assignments[0].subject_name, '英语');
});

test('import into empty storage adopts backup date and increments revision', () => {
  const incoming = h.validateBackup(backup({ date: '2026-10-20', assignments: [task()] }), index);
  const result = h.importRecord(initial(), incoming, { revision: 1 });
  assert.equal(result.current.date, '2026-10-20');
  assert.equal(result.revision, 2);
  assert.equal(result.current.assignments.length, 1);
});

test('merge import keeps existing tasks, deduplicates by id and preserves completed work', () => {
  const record = save(initial(), [task(first)]);
  const incoming = h.validateBackup(backup({ date: '2026-10-25', assignments: [task(first, true), task(second)] }), index);
  const result = h.importRecord(record, incoming, { revision: 2 });
  assert.equal(result.current.assignments.length, 2);
  assert.equal(result.current.assignments.find((t) => t.task_id === first).done, true);
  assert.equal(record.current.assignments[0].done, false);
  assert.equal(result.revision, 3);
});

test('merge different current dates keeps existing current and merges imported day into history', () => {
  const record = save(initial(), [task(first)]);
  const incoming = h.validateBackup(backup({ date: '2026-10-20', assignments: [task(second, true)] }, [{ date: '2026-10-19', assignments: [] }]), index);
  const result = h.importRecord(record, incoming, { revision: 2 });
  assert.equal(result.current.date, '2026-10-25');
  assert.equal(result.current.assignments[0].task_id, first);
  assert.deepEqual(result.archives.map((d) => d.date), ['2026-10-19', '2026-10-20']);
  assert.equal(result.archives[1].assignments[0].done, true);
});

test('explicit replace is supported but stale imports never overwrite', () => {
  const record = save(initial(), [task()]);
  const incoming = h.validateBackup(backup({ date: '2026-10-20', assignments: [] }), index);
  assert.throws(() => h.importRecord(record, incoming, { replace: true, revision: 1 }), (e) => e.status === 409);
  assert.equal(h.importRecord(record, incoming, { replace: true, revision: 2 }).current.date, '2026-10-20');
});

test('storage capacity errors are explicit failures', () => {
  assert.equal(h.storageError({ name: 'QuotaExceededError' }).status, 507);
  assert.match(h.storageError({ name: 'QuotaExceededError' }).message, /尚未保存/);
  assert.equal(h.storageError({ name: 'SecurityError' }).status, 503);
});
