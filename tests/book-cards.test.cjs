'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const library = require('../study/data/library.json');
const all = library.subjects.flatMap(subject => subject.chapters.flatMap(chapter => chapter.tasks));

test('408 chapter long-answer exercises share the second round while video frequency metadata stays in round one', () => {
  for (const subject of library.subjects.slice(4)) {
    assert(subject.chapters.some(chapter => chapter.phase === '第二轮'), subject.id);
    assert(!subject.chapters.some(chapter => ['应用综合', '二轮算法'].includes(chapter.phase)));
    for (const chapter of subject.chapters) {
      for (const task of chapter.tasks) {
        if (/大题/.test(task.quantity || '') || /【习题】.*大题/.test(task.title)) assert.equal(chapter.phase, '第二轮', task.id);
      }
    }
    assert.equal(subject.chapters.filter(c => c.phase === '第二轮').reduce((n, c) => n + c.tasks.length, 0), library.metadata.round_two_exercises.by_subject[subject.id]);
  }
  const ds = library.subjects.find(s => s.id === 'ds');
  assert.equal(ds.chapters.find(c => c.tasks.some(t => t.id === 'ds-617a7fa91f2c3dc9c7af')).phase, '基础一轮');
  const os = library.subjects.find(s => s.id === 'os');
  assert.equal(os.chapters.find(c => c.tasks.some(t => t.id === 'os-ffc387ea9b17aa5f2bdd')).phase, '第二轮');
  const cn = library.subjects.find(s => s.id === 'cn');
  assert.equal(cn.chapters.find(c => c.tasks.some(t => t.id === 'cn-08eb2607804646c592a3')).phase, '第二轮');
  assert.equal(cn.chapters.find(c => c.tasks.some(t => t.id === 'cn-3ec4df05747292d69344')).phase, '强化');
});

test('408 has no selectable book-title cards while the fixed subject order and valid chapters remain', () => {
  assert.deepEqual(library.subjects.map(subject => subject.id), ['english', 'calculus', 'linear', 'probability', 'ds', 'co', 'os', 'cn']);
  for (const subject of library.subjects) {
    for (const chapter of subject.chapters) {
      assert.ok(chapter.tasks.length > 0, chapter.id);
      if (['ds', 'co', 'os', 'cn'].includes(subject.id)) {
        for (const task of chapter.tasks) assert.ok(!task.title.includes('王道书'), task.id);
      }
    }
  }
});

test('retired book IDs are not selectable and contain only compatibility metadata', () => {
  const active = new Set(all.map(task => task.id));
  const seen = new Set();
  const fields = ['id', 'subject_id', 'estimated_minutes', 'estimated_source', 'estimate_group', 'source_video_minutes'];
  assert.ok(library.metadata.retired_tasks.length > 0);
  for (const task of library.metadata.retired_tasks) {
    assert.ok(!active.has(task.id));
    assert.ok(!seen.has(task.id));
    seen.add(task.id);
    assert.deepEqual(Object.keys(task), fields);
    assert.ok(['ds', 'co', 'os', 'cn'].includes(task.subject_id));
    assert.ok(task.estimated_minutes === null || (Number.isFinite(task.estimated_minutes) && task.estimated_minutes >= 0));
  }
});

test('task and estimate totals describe the active catalogue after retirement', () => {
  assert.equal(library.metadata.task_count, all.length);
  assert.equal(library.metadata.chapter_count, library.subjects.reduce((sum, subject) => sum + subject.chapters.length, 0));
  const known = all.filter(task => task.estimated_minutes !== null).length;
  assert.equal(library.metadata.estimates.known_tasks, known);
  assert.equal(library.metadata.estimates.unknown_tasks, all.length - known);
  for (const subject of library.subjects) {
    const tasks = subject.chapters.flatMap(chapter => chapter.tasks);
    assert.deepEqual(library.metadata.counts[subject.id], { chapters: subject.chapters.length, tasks: tasks.length });
    const known = tasks.filter(task => task.estimated_minutes !== null).length;
    assert.deepEqual(library.metadata.estimates.by_subject[subject.id], { known, unknown: tasks.length - known });
  }
});
