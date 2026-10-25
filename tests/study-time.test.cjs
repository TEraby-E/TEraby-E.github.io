'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const time = require('../study/study-time.js');

test('daily estimate totals sum real tasks and keep missing estimates explicit', () => {
  const summary = time.summarize([
    { task_id: 'a', estimated_minutes: 50, done: true },
    { task_id: 'b', estimated_minutes: 75, done: false },
    { task_id: 'c', estimated_minutes: null, done: false },
  ]);
  assert.equal(summary.minutes, 125);
  assert.equal(summary.completedMinutes, 50);
  assert.equal(summary.remainingMinutes, 75);
  assert.equal(summary.unknown, 1);
  assert.equal(time.formatMinutes(summary.minutes), '2小时5分钟');
});

test('shared whole-paper copies count once and require all chosen copies completed', () => {
  const assignments = [
    { task_id: 'calculus-paper', estimated_minutes: 180, estimate_group: 'math-paper', done: true },
    { task_id: 'linear-paper', estimated_minutes: 180, estimate_group: 'math-paper', done: false },
    { task_id: 'probability-paper', estimated_minutes: 180, estimate_group: 'math-paper', done: true },
  ];
  assert.equal(time.summarize(assignments).minutes, 180);
  assert.equal(time.summarize(assignments).completedMinutes, 0);
  assignments[1].done = true;
  assert.equal(time.summarize(assignments).completedMinutes, 180);
  assert.equal(time.summarize(assignments).groups, 1);
});

test('old saved records can recover estimates from the canonical task library', () => {
  const library = [{ chapters: [{ tasks: [{ id: 'old', estimated_minutes: 45, estimated_source: '原计划' }] }] }];
  assert.equal(time.summarize([{ task_id: 'old' }], library).minutes, 45);
  assert.equal(time.summarize([{ task_id: 'old', estimated_minutes: 30 }], library).minutes, 30);
  assert.equal(time.summarize([{ task_id: 'old', estimated_minutes: null }], library).unknown, 1);
});

test('zero and fractional estimates remain distinct from unknown', () => {
  assert.equal(time.getEstimate({ estimated_minutes: 0 }).label, '预计0分钟');
  assert.equal(time.getEstimate({ estimated_minutes: null }).label, '预计用时待补充');
  assert.equal(time.getEstimate({ estimated_minutes: 2.5, estimated_source: '原视频时长' }).label, '视频时长2.5分钟');
  assert.equal(time.summarize([{ estimated_minutes: 0.1 }, { estimated_minutes: 0.2 }]).minutes, 0.3);
  assert.equal(time.formatMinutes(60), '1小时');
  assert.equal(time.formatMinutes(0), '0分钟');
});

test('restored original estimates remain valid and shared copies have consistent durations', () => {
  const library = require('../study/data/library.json');
  const values = new Map();
  for (const subject of library.subjects) for (const chapter of subject.chapters) for (const task of chapter.tasks) {
    assert.ok(task.estimated_minutes === null || time.validMinutes(task.estimated_minutes), task.id);
    assert.equal(typeof task.estimated_source, 'string');
    if (task.estimate_group?.startsWith('shared:')) {
      if (values.has(task.estimate_group)) assert.equal(task.estimated_minutes, values.get(task.estimate_group), task.estimate_group);
      else values.set(task.estimate_group, task.estimated_minutes);
    }
  }
  assert.ok(values.size > 0);
});

test('actual time counts only completed recorded work and never substitutes an estimate', () => {
  const tasks = [
    { task_id: 'a', estimated_minutes: 60, actual_minutes: 42, done: true },
    { task_id: 'b', estimated_minutes: 20, actual_minutes: null, done: true },
    { task_id: 'c', estimated_minutes: 30, actual_minutes: 99, done: false },
    { task_id: 'd', estimated_minutes: 5, actual_minutes: 0, done: true },
  ];
  const summary = time.summarize(tasks);
  assert.equal(summary.minutes, 115);
  assert.equal(summary.actualMinutes, 42);
  assert.equal(summary.actualUnknown, 1);
  assert.equal(summary.actualKnown, 2);
  assert.equal(time.getActual(tasks[2]).label, '实际待完成');
  assert.equal(time.getActual(tasks[1]).label, '实际未记录');
  assert.equal(time.getActual(tasks[3]).label, '实际0分钟');
  assert.equal(time.comparisonLabel(tasks[0]), '预计1小时 / 实际42分钟');
});

test('actual time for shared copies of one original task is counted once', () => {
  const tasks = ['calculus', 'linear', 'probability'].map(subject_id => ({ subject_id, task_id: subject_id, estimate_group: 'one-paper', estimated_minutes: 180, actual_minutes: 135, done: true }));
  const summary = time.summarize(tasks);
  assert.equal(summary.minutes, 180);
  assert.equal(summary.actualMinutes, 135);
  assert.equal(summary.actualGroups, 1);
  assert.equal(summary.actualUnknown, 0);
});
