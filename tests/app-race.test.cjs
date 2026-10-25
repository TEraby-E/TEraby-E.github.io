const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../study/app.js'), 'utf8');
// Execute the real app's state and rendering functions, before event binding and
// startup. Network completion is controlled below; the load code is not copied.
const bindingStart = source.indexOf("\n  $('daily-tbody').addEventListener");
assert.ok(bindingStart > 0, 'the app event-binding boundary must be available');
const appPrefix = source.slice(0, bindingStart);
const subjects = ['英语', '高数', '线代', '概率论', '数据结构', '计组', '操作系统', '计网'];
const subjectIds = ['english', 'calculus', 'linear', 'probability', 'ds', 'co', 'os', 'cn'];
const fixtureLibrary = { subjects: subjects.map((name, index) => ({ id: subjectIds[index], name, chapters: [] })) };

function task(id, title) {
  return { task_id: id, subject_id: 'english', subject_name: '英语', chapter_id: 'fixture', chapter_title: '', title, detail: '', done: false };
}

function day(revision, assignments) {
  return { date: '2026-10-25', revision, assignments, history: [], completed_ids: [] };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createApp(initial = day(1, [task('existing', '已经安排的任务')])) {
  const requests = [];
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', textContent: '', hidden: false, open: false, disabled: false,
      style: {}, dataset: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
      close() { this.open = false; },
      contains() { return false; },
      append() {},
      classList: { add() {}, remove() {}, toggle() {} },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    fixtureLibrary,
    fixtureInitial: initial,
    document: { getElementById: element, querySelectorAll: () => [], querySelector: () => null, body: { append() {} }, activeElement: null },
    window: {
      clearTimeout() {}, setTimeout() { return 1; },
      StudyStore: { request(url, options) { const wait = deferred(); requests.push({ url, options, ...wait }); return wait.promise; } },
    },
  });
  vm.runInContext(appPrefix + `
    state = normaliseState(fixtureInitial);
    library = fixtureLibrary.subjects;
    renderDay();
    globalThis.fixtureApp = {
      startLoad: () => load(),
      addTask: (task) => { state.assignments.push(task); changed(); },
      snapshot: () => JSON.stringify(state)
    };
  })();`, context, { filename: 'study/app.js' });
  return {
    app: context.fixtureApp,
    requests,
    snapshot: () => JSON.parse(context.fixtureApp.snapshot()),
    table: () => element('daily-tbody').innerHTML,
    saveStatus: () => element('save-status').dataset.status,
  };
}

function settleLoad(requests, offset, snapshot) {
  assert.equal(requests[offset].url, '/api/library');
  assert.equal(requests[offset + 1].url, '/api/state');
  requests[offset].resolve(fixtureLibrary);
  requests[offset + 1].resolve(snapshot);
}

test('a delayed successful refresh cannot discard a task selected while it was loading', async () => {
  const fixture = createApp();
  const pending = fixture.app.startLoad();
  fixture.app.addTask(task('newly-selected', '刚选入的新任务'));
  assert.match(fixture.table(), /刚选入的新任务/);

  settleLoad(fixture.requests, 0, day(2, [task('existing', '已经安排的任务')]));
  await pending;

  assert.equal(fixture.snapshot().assignments.length, 2);
  assert.ok(fixture.snapshot().assignments.some((entry) => entry.task_id === 'newly-selected'));
  assert.match(fixture.table(), /刚选入的新任务/);
  assert.equal(fixture.saveStatus(), 'saving', 'unsaved local work must not be labelled saved');
});

test('a delayed failed refresh cannot replace newly edited tasks with an error empty state', async () => {
  const fixture = createApp();
  const pending = fixture.app.startLoad();
  fixture.app.addTask(task('newly-selected', '刚选入的新任务'));

  fixture.requests[0].resolve(fixtureLibrary);
  fixture.requests[1].reject(new Error('模拟延迟读取失败'));
  await pending;

  assert.equal(fixture.snapshot().assignments.length, 2);
  assert.match(fixture.table(), /刚选入的新任务/);
  assert.doesNotMatch(fixture.table(), /学习清单暂时没有载入/);
  assert.equal(fixture.saveStatus(), 'saving');
});

test('an older overlapping refresh cannot overwrite the newer refresh result', async () => {
  const fixture = createApp();
  const older = fixture.app.startLoad();
  const newer = fixture.app.startLoad();

  settleLoad(fixture.requests, 2, day(3, [task('latest', '最新窗口保存的任务')]));
  await newer;
  settleLoad(fixture.requests, 0, day(2, [task('stale', '过期读取的任务')]));
  await older;

  assert.equal(fixture.snapshot().revision, 3);
  assert.deepEqual(fixture.snapshot().assignments.map((entry) => entry.task_id), ['latest']);
  assert.match(fixture.table(), /最新窗口保存的任务/);
  assert.doesNotMatch(fixture.table(), /过期读取的任务/);
});

test('a refresh never rolls an already newer revision back to an older stored snapshot', async () => {
  const fixture = createApp(day(5, [task('latest', '已有最新任务')]));
  const pending = fixture.app.startLoad();
  settleLoad(fixture.requests, 0, day(4, [task('stale', '较旧快照任务')]));
  await pending;

  assert.equal(fixture.snapshot().revision, 5);
  assert.match(fixture.table(), /已有最新任务/);
  assert.doesNotMatch(fixture.table(), /较旧快照任务/);
});
