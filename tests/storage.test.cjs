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

test('legacy 408 stage preferences migrate once and remain valid in old backups and in-flight saves', () => {
  const record = { ...save(initial(), [task(first, true)]), subject_phases: { ds: '二轮算法', co: '应用综合', os: '应用综合', cn: '应用综合', calculus: '强化' } };
  const migrated = h.hydrateRecordEstimates(record, index);
  assert.deepEqual(migrated.subject_phases, { ds: '第二轮', co: '第二轮', os: '第二轮', cn: '第二轮', calculus: '强化' });
  assert.equal(migrated.revision, record.revision + 1);
  assert.deepEqual(migrated.current, record.current);
  assert.strictEqual(h.hydrateRecordEstimates(migrated, index), migrated);
  const incoming = h.validateBackup({ ...backup(record.current), subject_phases: record.subject_phases }, index);
  assert.deepEqual(incoming.subject_phases, migrated.subject_phases);
  const saved = h.saveRecord(record, { date: record.current.date, revision: record.revision, assignments: record.current.assignments, subject_phases: record.subject_phases }, index);
  assert.deepEqual(saved.subject_phases, migrated.subject_phases);
});

test('subject stages persist through saving, archiving, backup import and conservative merging', () => {
  const phases = Object.fromEntries(library.subjects.map(s => [s.id, s.chapters[0].phase]));
  const saved = h.saveRecord(initial(), { date: initial().current.date, revision: 1, assignments: [task()], subject_phases: phases }, index);
  assert.deepEqual(h.stateOf(saved).subject_phases, phases);
  const advanced = h.archiveRecord(saved, { date: saved.current.date, revision: saved.revision });
  assert.deepEqual(advanced.subject_phases, phases);
  assert.equal(advanced.archives[0].assignments[0].title, index.get(first).task.title);
  const incoming = h.validateBackup({ ...backup(saved.current, saved.archives), subject_phases: phases }, index);
  assert.deepEqual(incoming.subject_phases, phases);
  const imported = h.importRecord(initial(), incoming, { revision: 1 });
  assert.deepEqual(imported.subject_phases, phases);
  const existing = { ...saved, subject_phases: { ds: '' } };
  const merged = h.importRecord(existing, incoming, { revision: existing.revision });
  assert.equal(merged.subject_phases.ds, '');
  assert.equal(merged.subject_phases.cn, phases.cn);
  for (const invalid of [{ unknown: '强化' }, { ds: '不存在的阶段' }, { ds: 1 }, []]) {
    assert.throws(() => h.saveRecord(saved, { date: saved.current.date, revision: saved.revision, assignments: [], subject_phases: invalid }, index));
  }
});

test('multi-day overall completion is frozen in the archived day and survives backup validation', () => {
  const entry = h.normaliseAssignments([{ ...task(), task_mode: 'multi-day', done: true, actual_minutes: 45 }], index)[0];
  const record = { ...initial(), current: { date: initial().current.date, assignments: [entry] }, library_completed_ids: [first] };
  const advanced = h.archiveRecord(record, { date: record.current.date, revision: record.revision });
  assert.equal(advanced.archives[0].assignments[0].overall_completed, true);
  assert.equal(advanced.current.assignments.length, 0);
  const restored = h.validateBackup(backup(advanced.current, advanced.archives), index);
  assert.equal(restored.archives[0].assignments[0].overall_completed, true);
  assert.equal(restored.archives[0].assignments[0].actual_minutes, 45);
  assert.equal(record.current.assignments[0].overall_completed, undefined);
});

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

test('estimated time is restored for old tasks and saved as part of a day snapshot', () => {
  const canonical = index.get(first).task;
  const restored = h.normaliseAssignments([task(first)], index)[0];
  assert.equal(restored.estimated_minutes, canonical.estimated_minutes);
  const saved = save(initial(), [{ ...task(first, true), estimated_minutes: 35, estimated_source: '今日手动安排' }]);
  assert.equal(saved.current.assignments[0].estimated_minutes, 35);
  assert.equal(saved.current.assignments[0].estimate_group, canonical.estimate_group);
  const archived = h.archiveRecord(saved, { date: saved.current.date, revision: saved.revision, carry_pending: false });
  assert.equal(archived.archives[0].assignments[0].estimated_minutes, 35);
  const imported = h.validateBackup(backup(archived.current, archived.archives), index);
  assert.equal(imported.archives[0].assignments[0].estimated_minutes, 35);
  assert.equal(imported.archives[0].assignments[0].estimated_source, '今日手动安排');
});

test('invalid time estimates cannot enter saved or imported records', () => {
  for (const value of [-1, NaN, Infinity, '30', 525601]) {
    assert.throws(() => h.normaliseAssignments([{ ...task(first), estimated_minutes: value }], index));
  }
  assert.equal(h.normaliseAssignments([{ ...task(first), estimated_minutes: null }], index)[0].estimated_minutes, null);
  assert.equal(h.normaliseAssignments([{ ...task(first), estimated_minutes: 0 }], index)[0].estimated_minutes, 0);
});

test('legacy current and archived tasks receive one-time estimate snapshots without changing their content', () => {
  const old = initial();
  const savedTask = { task_id: first, title: '原来保存的标题', detail: '原来的笔记', done: true };
  old.current.assignments = [{ ...savedTask }];
  old.archives = [{ date: '2026-10-24', assignments: [{ ...savedTask }] }];
  const result = h.hydrateRecordEstimates(old, index);
  assert.equal(result.revision, old.revision + 1);
  assert.equal(result.current.assignments[0].estimated_minutes, index.get(first).task.estimated_minutes);
  assert.equal(result.archives[0].assignments[0].estimated_minutes, index.get(first).task.estimated_minutes);
  assert.equal(result.current.assignments[0].title, savedTask.title);
  assert.equal(result.current.assignments[0].detail, savedTask.detail);
  assert.equal(result.current.assignments[0].done, true);
  assert.equal(result.current.assignments[0].actual_minutes, null);
  assert.ok(!Object.hasOwn(old.current.assignments[0], 'estimated_minutes'));
  assert.strictEqual(h.hydrateRecordEstimates(result, index), result);
});

test('actual completion minutes survive saving, archiving and backup import', () => {
  const saved = save(initial(), [{ ...task(first, true), actual_minutes: 27.5 }]);
  assert.equal(saved.current.assignments[0].actual_minutes, 27.5);
  const archive = h.archiveRecord(saved, { date: saved.current.date, revision: saved.revision, carry_pending: false });
  const imported = h.validateBackup(backup(archive.current, archive.archives), index);
  assert.equal(imported.archives[0].assignments[0].actual_minutes, 27.5);
  assert.equal(save(saved, [{ ...saved.current.assignments[0], done: false }]).current.assignments[0].actual_minutes, null);
  for (const invalid of [-1, Infinity, NaN, '20', 525601]) assert.throws(() => h.normaliseAssignments([{ ...task(first, true), actual_minutes: invalid }], index));
});

test('merging a backup fills missing actual time but preserves an existing recorded value', () => {
  const existing = h.normaliseAssignments([{ ...task(first, true), actual_minutes: 20 }], index);
  const incoming = h.normaliseAssignments([{ ...task(first, true), actual_minutes: 25 }], index);
  assert.equal(h.mergeTasks(existing, incoming)[0].actual_minutes, 20);
  existing[0].actual_minutes = null;
  assert.equal(h.mergeTasks(existing, incoming)[0].actual_minutes, 25);
  existing[0].done = false;
  assert.equal(h.mergeTasks(existing, incoming)[0].done, true);
});

test('retired library cards remain readable only through complete saved snapshots', () => {
  const id = 'ds-retired-fixture';
  const retiredIndex = h.libraryIndex({ subjects: library.subjects, metadata: { retired_tasks: [{ id, subject_id: 'ds', estimated_minutes: 15, estimated_source: '原计划', estimate_group: id }] } });
  const snapshot = { task_id: id, subject_id: 'ds', title: '以前保存的阅读任务', detail: '原学习笔记', chapter_title: '原章节', done: true, actual_minutes: 18 };
  const result = h.normaliseAssignments([snapshot], retiredIndex)[0];
  assert.equal(result.title, snapshot.title);
  assert.equal(result.detail, snapshot.detail);
  assert.equal(result.estimated_minutes, 15);
  assert.equal(result.actual_minutes, 18);
  assert.throws(() => h.normaliseAssignments([{ task_id: id, done: true }], retiredIndex));
  assert.throws(() => h.normaliseAssignments([{ ...snapshot, subject_id: 'cn' }], retiredIndex));
});
