'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const models = require('../study/learning-model.js');
const time = require('../study/study-time.js');
const store = require('../study/storage.js').helpers;
const realLibrary = require('../study/data/library.json');
const app = fs.readFileSync(path.join(__dirname, '../study/app.js'), 'utf8');
const prefix = app.slice(0, app.indexOf("\n  $('daily-tbody').addEventListener"));

function fixture({ multi = true, actual = null, shared = false, withoutSnapshotEstimate = false } = {}) {
  const ids = ['english', 'calculus', 'linear', 'probability', 'ds', 'co', 'os', 'cn'];
  const names = ['英语', '高数', '线代', '概率论', '数据结构', '计组', '操作系统', '计网'];
  const tasks = [4, ...(shared ? [5] : [])].map(i => ({ id: `${ids[i]}-fixture`, task_id: `${ids[i]}-fixture`, subject_id: ids[i], title: '学习任务', detail: '', done: actual !== null, actual_minutes: actual, estimated_minutes: 60, task_mode: multi ? 'multi-day' : 'single-day', estimate_group: shared ? 'shared-fixture' : null }));
  const raw = { subjects: ids.map((id, i) => ({ id, name: names[i], chapters: [{ id: `${id}-chapter`, phase: '基础', title: '第一节', tasks: tasks.filter(t => t.subject_id === id).map(task => ({...task})) }] })) };
  if (withoutSnapshotEstimate) tasks.forEach(task => { delete task.estimated_minutes; });
  const nodes = new Map();
  function element(id) {
    if (nodes.has(id)) return nodes.get(id);
    const node = { dataset: {}, style: {}, classList: { toggle() {} }, open: false, textContent: '', inputs: [], checked: false,
      setAttribute() {}, contains() { return false; }, append() {}, focus() {}, select() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelectorAll(selector) { return selector.includes('completion-index') ? this.inputs.filter(input => input.dataset.completionIndex !== undefined) : selector === 'input' ? this.inputs : []; },
      querySelector(selector) {
        const match = selector.match(/data-completion-finish="(\d+)"/);
        return match ? this.inputs.find(input => input.dataset.completionFinish === match[1]) : selector === 'input' ? this.inputs[0] : null;
      },
    };
    Object.defineProperty(node, 'innerHTML', { get() { return this.html || ''; }, set(html) {
      this.html = html;
      if (id !== 'completion-fields') return;
      this.inputs = [...html.matchAll(/<input\b[^>]*>/g)].map(([tag]) => {
        const number = tag.match(/data-completion-index="(\d+)"/);
        const finish = tag.match(/data-completion-finish="(\d+)"/);
        return { dataset: { ...(number ? { completionIndex: number[1] } : {}), ...(finish ? { completionFinish: finish[1] } : {}) }, value: tag.match(/value="([^"]*)"/)?.[1] || '', checked: /\schecked(?:\s|>)/.test(tag), validity: {}, focus() {}, select() {} };
      });
    } });
    nodes.set(id, node);
    return node;
  }
  const context = vm.createContext({ raw, tasks, document: { getElementById: element, activeElement: null, body: { append() {} }, querySelectorAll: () => [], querySelector: () => null }, window: {
    StudyModels: models, StudyTime: time, clearTimeout() {}, setTimeout() { return 0; }, matchMedia() { return { matches: true }; },
    StudyStore: { async request(url, options) {
      const payload = JSON.parse(options.body);
      return { ...payload, revision: payload.revision + 1, history: [], completed_ids: [] };
    } },
  } });
  vm.runInContext(prefix + `
    library = raw.subjects.map(window.StudyModels.createSubject);
    state = normaliseState({date:'2026-10-31', revision:1, assignments:tasks});
    globalThis.flow = {
      open: mode => openCompletion(['ds-fixture'], mode), save: () => saveCompletion(),
      snapshot: () => JSON.stringify(state), completed: () => new LearningTask(state.assignments[0]).completed,
      undoLast: () => {new LearningTask(state.assignments[0]).undoLastCheckin(); changeVersion++;},
      markSingle: () => new LearningTask(state.assignments[0]).setCompleted(true)
    };
  })();`, context);
  return { flow: context.flow, snapshot: () => JSON.parse(context.flow.snapshot()), element,
    minutes(value) { element('completion-fields').inputs.find(input => input.dataset.completionIndex !== undefined).value = String(value); },
    finish(value) { element('completion-fields').inputs.find(input => input.dataset.completionFinish !== undefined).checked = value; },
  };
}

test('multi-day sessions append once, retain legacy minutes, and finish only through the check-in dialog', async () => {
  const f = fixture({ actual: 12 });
  f.flow.open('segment');
  assert.equal(f.element('completion-fields').inputs.find(input => input.dataset.completionIndex !== undefined).value, '60');
  f.minutes(20); await f.flow.save();
  assert.equal(f.snapshot().assignments[0].actual_minutes, 32);
  assert.deepEqual(f.snapshot().assignments[0].checkin_segments, [12, 20]);
  assert.equal(f.flow.completed(), false);
  f.flow.open('segment'); f.minutes(5); f.finish(true); await f.flow.save();
  assert.equal(f.snapshot().assignments[0].actual_minutes, 37);
  assert.equal(f.flow.completed(), true);
  f.flow.open('status'); f.finish(false); await f.flow.save();
  assert.equal(f.flow.completed(), false);
  assert.equal(f.snapshot().assignments[0].actual_minutes, 37);
  f.flow.undoLast();
  assert.deepEqual(f.snapshot().assignments[0].checkin_segments, [12, 20]);
  assert.equal(f.snapshot().assignments[0].actual_minutes, 32);
});

test('shared multi-day copies record one session without multiplying time', async () => {
  const f = fixture({ shared: true });
  f.flow.open('segment'); f.minutes(15); await f.flow.save();
  const tasks = f.snapshot().assignments;
  for (const task of tasks) { assert.equal(task.actual_minutes, 15); assert.deepEqual(task.checkin_segments, [15]); }
  assert.equal(time.summarizeActual(tasks).actualMinutes, 15);
});

test('single-day completion has no finish switch and manual finish cannot skip a single-day task', async () => {
  const f = fixture({ multi: false });
  assert.equal(f.flow.markSingle(), false);
  assert.equal(f.flow.completed(), false);
  f.flow.open('complete');
  assert(!f.element('completion-fields').innerHTML.includes('data-completion-finish'));
  assert.equal(f.element('completion-fields').inputs.find(input => input.dataset.completionIndex !== undefined).value, '60');
  f.minutes(17); await f.flow.save();
  assert.equal(f.snapshot().assignments[0].actual_minutes, 17);
  assert.equal(f.flow.completed(), true);
  f.flow.open('edit');
  assert.equal(f.element('completion-fields').inputs.find(input => input.dataset.completionIndex !== undefined).value, '17');
});

test('fresh unsaved selections recover the default actual input from their canonical task', () => {
  const f = fixture({ multi: false, withoutSnapshotEstimate: true });
  f.flow.open('complete');
  assert.equal(f.element('completion-fields').inputs.find(input => input.dataset.completionIndex !== undefined).value, '60');
  assert.equal(models.defaultActualInput([{ done:true, actual_minutes:0, estimated_minutes:60 }]), '0');
  assert.equal(models.defaultActualInput([{ estimated_minutes:null }]), '');
});

test('segments survive archiving and backup validation while the next day starts without old segments', () => {
  const index = store.libraryIndex(realLibrary);
  const task = realLibrary.subjects.find(subject => subject.id === 'calculus').chapters.flatMap(chapter => chapter.tasks).find(task => task.task_mode === 'multi-day');
  const record = store.saveRecord(store.initialRecord('2026-10-31'), { date: '2026-10-31', revision: 1, assignments: [{ task_id: task.id, done: true, actual_minutes: 45, checkin_segments: [20, 25], task_mode: 'multi-day' }] }, index);
  const next = store.archiveRecord(record, { date: record.current.date, revision: record.revision });
  assert.deepEqual(next.archives[0].assignments[0].checkin_segments, [20, 25]);
  assert.deepEqual(next.current.assignments[0].checkin_segments, []);
  assert.equal(next.current.assignments[0].actual_minutes, null);
  const restored = store.validateBackup({ format: 'sjtu-study-checkin-backup', version: 1, current: next.current, archives: next.archives }, index);
  assert.equal(restored.archives[0].assignments[0].actual_minutes, 45);
  assert.throws(() => store.normaliseAssignments([{ task_id: task.id, done: true, actual_minutes: 44, checkin_segments: [20, 25] }], index));
});

test('merging a legacy completed day into a pending multi-day task never leaves an inconsistent empty segment array', () => {
  const index = store.libraryIndex(realLibrary);
  const task = realLibrary.subjects.find(subject => subject.id === 'calculus').chapters.flatMap(chapter => chapter.tasks).find(task => task.task_mode === 'multi-day');
  const existing = store.normaliseAssignments([{ task_id: task.id, done: false, checkin_segments: [] }], index);
  const incoming = store.normaliseAssignments([{ task_id: task.id, done: true, actual_minutes: 45 }], index);
  const merged = store.mergeTasks(existing, incoming);
  assert.equal(merged[0].actual_minutes, 45);
  assert.doesNotThrow(() => store.normaliseAssignments(merged, index));
  assert.deepEqual(models.segmentsOf(merged[0]), [45]);
});
