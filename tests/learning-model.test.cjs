'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const models = require('../study/learning-model.js');
const time = require('../study/study-time.js');
const h = require('../study/storage.js').helpers;
const library = require('../study/data/library.json');

test('every active DS source row matches the complete reference table and round-one legacy extras are gone', () => {
  const reference = require('./fixtures/ds-reference-2027.json');
  const subject = library.subjects.find(subject => subject.id === 'ds');
  const tasks = subject.chapters.flatMap(chapter => chapter.tasks);
  const source = tasks.filter(task => task.source_sheet === '数据结构');
  assert.equal(source.length, reference.tasks.length);
  assert.equal(source.length + reference.excluded_book_rows.length, reference.source_task_rows);
  const byRow = new Map(source.map(task => [task.source_row, task]));
  for (const expected of reference.tasks) {
    const task = byRow.get(expected.source_row);
    assert(task, `missing row ${expected.source_row}`);
    for (const key of ['title', 'kind', 'quantity', 'remarks', 'section_name']) assert.equal(task[key], expected[key], `row ${expected.source_row}: ${key}`);
    const section = subject.sections[task.section_name];
    assert.equal(section.difficulty, expected.difficulty, `row ${expected.source_row}: difficulty`);
    assert.equal(section.estimated_minutes, expected.section_estimated_minutes, `row ${expected.source_row}: section time`);
    assert.deepEqual(section.exam_frequency, expected.exam_frequency, `row ${expected.source_row}: frequency`);
  }
  for (const chapter of subject.chapters.filter(chapter => chapter.phase === '基础一轮')) for (const task of chapter.tasks) assert.equal(task.source_sheet, '数据结构', task.id);
  for (const computing of library.subjects.slice(4)) for (const chapter of computing.chapters) for (const task of chapter.tasks) assert(!/期中|期末/.test(task.title), task.id);
});

test('numeric frequency fields leave legacy remarks without deleting genuine qualitative guidance', () => {
  const onlyFrequency = new models.TaskPresentation({ title: '绪论', section_name: '1.1 数据结构的基本概念', remarks: '小题考频：8；大题考频：11' });
  assert.equal(onlyFrequency.remarks, '');
  assert.deepEqual(onlyFrequency.info.exam_frequency, { small: 8, large: 11 });
  const mixed = new models.TaskPresentation({ title: '学习任务', section_name: '本节', remarks: '先做例题；章考频：小题15、大题2；难度：☆☆☆；本节考频较高，难度不大。' });
  assert.equal(mixed.remarks, '先做例题；本节考频较高，难度不大。');
  assert.equal(mixed.info.difficulty, '☆☆☆');
  assert.deepEqual(mixed.info.exam_frequency, { small: 15, large: 2 });
});

test('old frequency-only snapshots migrate once while actual time and completion remain unchanged', () => {
  const index = h.libraryIndex(library);
  const task = library.subjects.find(subject => subject.id === 'ds').chapters.flatMap(chapter => chapter.tasks).find(task => task.source_row === 3 && task.source_sheet === '数据结构');
  const saved = h.saveRecord(h.initialRecord('2026-10-31'), { date: '2026-10-31', revision: 1, assignments: [{ task_id: task.id, done: true, actual_minutes: 17 }] }, index);
  saved.current.assignments[0].remarks = '小题考频：8；大题考频：11';
  const updated = h.hydrateRecordEstimates(saved, index);
  assert.equal(updated.current.assignments[0].remarks, '');
  assert.deepEqual(updated.current.assignments[0].exam_frequency, { small: 8, large: 11 });
  assert.equal(updated.current.assignments[0].actual_minutes, 17);
  assert.equal(updated.current.assignments[0].done, true);
  assert.equal(updated.current.date, saved.current.date);
  assert.strictEqual(h.hydrateRecordEstimates(updated, index), updated);
});

test('all four computing subjects use one subclass and one subsection schema without duplicate task membership', () => {
  for (const subject of library.subjects) {
    const model = models.createSubject(subject);
    assert(model instanceof models.StudySubject);
    if (!['ds', 'co', 'os', 'cn'].includes(subject.id)) { assert(!(model instanceof models.ComputingSubject)); continue; }
    assert(model instanceof models.ComputingSubject);
    const tasks = subject.chapters.flatMap(chapter => chapter.tasks);
    const known = new Set(tasks.map(task => task.id));
    const seen = new Set();
    for (const [name, section] of Object.entries(subject.sections)) {
      assert(name.trim());
      assert.deepEqual(Object.keys(section).sort(), ['difficulty', 'estimated_minutes', 'exam_frequency', 'learning_tasks', 'remarks'].sort());
      assert.deepEqual(Object.keys(section.exam_frequency).sort(), ['small', 'large'].sort());
      for (const id of section.learning_tasks) { assert(known.has(id), id); assert(!seen.has(id), id); seen.add(id); }
    }
    assert.equal(seen.size, tasks.length);
    for (const task of tasks) assert.equal(model.sectionFor(task).name, task.section_name);
  }
});

test('OS and CN import every source row and exclude book-only cards while retaining multiline remarks', () => {
  for (const [id, imported, excluded] of [['os', 136, 82], ['cn', 140, 62]]) {
    const subject = library.subjects.find(subject => subject.id === id);
    const tasks = subject.chapters.flatMap(chapter => chapter.tasks).filter(task => task.source_id?.startsWith(`${id}完整规划:`));
    assert.equal(tasks.length, imported);
    assert.equal(library.metadata.coverage.complete_plans[id].excluded_book_rows, excluded);
    assert.equal(library.metadata.coverage.complete_plans[id].source_rows, imported + excluded);
    const model = models.createSubject(subject);
    for (const task of tasks) {
      const section = model.sectionFor(task);
      // The supplied OS 4.2 difficulty cell is blank; preserve it rather than invent stars.
      assert(section.difficulty || (id === 'os' && task.section_name === '4.2 目录与文件'));
      assert(!task.title.includes('王道书'));
    }
    const large = new Set(subject.chapters.filter(chapter => chapter.phase === '第二轮').flatMap(chapter => chapter.tasks.map(task => task.id)));
    for (const task of tasks.filter(task => /大题/.test(task.title + task.quantity))) assert(large.has(task.id));
  }
  const cn = library.subjects.find(subject => subject.id === 'cn');
  assert(cn.chapters.flatMap(chapter => chapter.tasks).some(task => task.remarks.includes('海明码是本章难点') && task.remarks.includes('CRC是本节重点')));
});

test('CO stores all 28 subsection star ratings and completes screenshot-truncated notes', () => {
  const co = library.subjects.find(subject => subject.id === 'co');
  const numbered = Object.entries(co.sections).filter(([name]) => /^\d+\.\d+/.test(name)).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));
  assert.equal(numbered.length, 28);
  assert.deepEqual(numbered.map(([, section]) => section.difficulty.length), [1,4,3,3,5,4,1,2,3,2,4,4,2,3,4,2,1,3,4,5,3,5,3,2,3,2,2,4]);
  const tasks = co.chapters.flatMap(chapter => chapter.tasks);
  assert(!tasks.some(task => /〔原图/.test(task.remarks)));
  assert(tasks.find(task => task.source_row === 272).remarks.includes('几种IO方式的原理'));
});

test('complete DS table keeps IDs while assigning exact subsection and topic difficulties', () => {
  const ds = library.subjects.find(subject => subject.id === 'ds');
  const model = models.createSubject(ds);
  const tasks = ds.chapters.flatMap(chapter => chapter.tasks);
  const byRow = row => tasks.find(task => task.source_sheet === '数据结构' && task.source_row === row);
  assert.equal(model.sectionFor(byRow(3)).difficulty, '☆');
  assert.equal(model.sectionFor(byRow(178)).difficulty, '☆☆☆☆');
  assert.equal(model.sectionFor(byRow(186)).difficulty, '☆☆☆');
  assert.equal(model.sectionFor(byRow(218)).difficulty, '☆☆☆☆');
  assert.equal(model.sectionFor(byRow(225)).difficulty, '☆☆☆☆☆');
  assert.equal(model.sectionFor(byRow(237)).difficulty, '☆☆☆☆');
  assert.equal(byRow(28).title, '【习题】大题：10~15');
  assert.equal(byRow(28).id, 'ds-976bb6e8422879c29a13');
  for (const task of tasks.filter(task => task.source_sheet === '数据结构')) {
    assert(model.sectionFor(task).difficulty);
    assert(!task.title.includes('【点击跳转】'));
  }
});

test('subsection metadata survives saving and archiving without discarding actual time', () => {
  const index = h.libraryIndex(library);
  const task = [...index.values()].find(entry => entry.subject.id === 'co' && entry.task.source_row === 4).task;
  const record = h.saveRecord(h.initialRecord('2026-10-31'), { date: '2026-10-31', revision: 1, assignments: [{ task_id: task.id, done: true, actual_minutes: 31 }] }, index);
  const saved = record.current.assignments[0];
  assert.equal(saved.difficulty, '☆');
  assert.deepEqual(saved.exam_frequency, { small: 15, large: 2 });
  assert.equal(saved.section_name, '1.1 计算机发展历程');
  const archived = h.archiveRecord(record, { date: record.current.date, revision: record.revision });
  const restored = h.validateBackup({ format: 'sjtu-study-checkin-backup', version: 1, current: archived.current, archives: archived.archives }, index);
  assert.equal(restored.archives[0].assignments[0].actual_minutes, 31);
  assert.equal(restored.archives[0].assignments[0].difficulty, '☆');
});

test('daily and library cards share learning labels while daily actual-time block becomes a standalone check-in action', () => {
  const app = fs.readFileSync(path.join(__dirname, '../study/app.js'), 'utf8');
  const prefix = app.slice(0, app.indexOf("\n  $('daily-tbody').addEventListener"));
  const context = vm.createContext({ raw: library, window: { StudyTime: time, StudyModels: models } });
  vm.runInContext(prefix + `
    library = raw.subjects.map(window.StudyModels.createSubject);
    state = normaliseState({date: '2026-10-31', assignments: []});
    const task = library.find(s => s.id === 'co').chapters.flatMap(c => c.tasks).find(t => t.source_row === 4);
    const daily = {...task, task_id: task.id, subject_id: 'co', done: false};
    globalThis.cards = [new DailyTaskCardView(daily).render(), new LibraryTaskCardView(task).render(), new HistoryTaskCardView({...daily, done:true, actual_minutes:37}).render()];
  })();`, context);
  for (const card of context.cards) {
    assert(card.includes('难度：☆'));
    assert(card.includes('小题考频：15'));
    assert(card.includes('大题考频：2'));
    assert(!card.includes('参考：'));
    assert(card.includes('class=\"card-notes\" open'));
  }
  assert(!context.cards[0].includes('card-time-cell is-actual'));
  assert(context.cards[0].includes('data-action="record-actual"'));
  assert(context.cards[0].includes('card-checkin-button'));
  assert(!context.cards[0].includes('预计用时'));
  for (const card of context.cards) assert(!card.includes('card-time-cell is-actual'));
  assert(!context.cards[2].includes('data-action="record-actual"'));
});

test('shared presentation removes origin references but preserves actual learning notes', () => {
  const task = { title:'栈', detail:'练习出栈顺序', section_name:'3.1 栈', difficulty:'☆☆', exam_frequency:{small:6,large:0}, kind:'必做题', quantity:'3题', reference:'原表《数据结构》第50行3.1 栈', remarks:'先手算。参考答案检查边界条件。' };
  const view = new models.TaskPresentation(task);
  assert(!view.metadataText.includes('原表'));
  assert(!view.metadata.some(([label]) => label === '参考'));
  assert(view.metadataText.includes('大题考频：0'));
  assert(view.metadataText.includes('任务量：3题'));
  assert.equal(view.remarks,task.remarks);
  const legacy = new models.TaskPresentation({...task,detail:'完成训练。原表备注：先复习。〔原图右端不全〕'});
  assert.equal(legacy.detail,'完成训练。先复习。');
});
