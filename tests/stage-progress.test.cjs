'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const time = require('../study/study-time.js');
const source = fs.readFileSync(path.join(__dirname, '../study/app.js'), 'utf8');
const prefix = source.slice(0, source.indexOf("\n  $('daily-tbody').addEventListener"));

function stageFixture() {
  const subjects = ['english', 'calculus', 'linear', 'probability', 'ds', 'co', 'os', 'cn'].map(id => ({ id, chapters: [
    { id: `${id}-one`, phase: '基础', tasks: [
      { id: `${id}-a`, estimated_minutes: 30 },
      { id: `${id}-b`, estimated_minutes: 90, task_mode: 'multi-day' },
      { id: `${id}-unknown`, estimated_minutes: null },
    ] },
    { id: `${id}-two`, phase: '强化', tasks: [{ id: `${id}-c`, estimated_minutes: 200 }] },
  ] }));
  const context = vm.createContext({ subjects, window: { StudyTime: time } });
  vm.runInContext(prefix + `
    library = subjects;
    state = normaliseState({ date: '2026-10-27', assignments: [] });
    globalThis.fixture = {
      progress: (id, phase) => JSON.stringify(new LearningStage(library.find(s => s.id === id), phase).progress),
      mark: (id, complete) => { new LearningTask({ id }).setCompleted(complete); changeVersion++; },
      checkin: (id) => { state.assignments.push({ task_id: id, done: true, task_mode: 'multi-day' }); changeVersion++; }
    };
  })();`, context);
  return context.fixture;
}

test('all eight subjects share stage progress weighted by estimated minutes, independent of daily selection', () => {
  const fixture = stageFixture();
  for (const id of ['english', 'calculus', 'linear', 'probability', 'ds', 'co', 'os', 'cn']) {
    fixture.mark(`${id}-a`, true);
    const base = JSON.parse(fixture.progress(id, '基础'));
    assert.equal(base.minutes, 120);
    assert.equal(base.completedMinutes, 30);
    assert.equal(base.percent, 25);
    assert.equal(base.unknown, 1);
    assert.equal(JSON.parse(fixture.progress(id, '强化')).percent, 0);
    fixture.checkin(`${id}-b`);
    assert.equal(JSON.parse(fixture.progress(id, '基础')).percent, 25);
    fixture.mark(`${id}-b`, true);
    assert.equal(JSON.parse(fixture.progress(id, '基础')).percent, 100);
    fixture.mark(`${id}-a`, false);
    assert.equal(JSON.parse(fixture.progress(id, '基础')).percent, 75);
  }
});

test('stage with no known duration reports an unknown percentage instead of fabricated completion', () => {
  const fixture = stageFixture();
  const progress = JSON.parse(fixture.progress('ds', '未设置'));
  assert.equal(progress.percent, null);
  assert.equal(progress.minutes, 0);
});
