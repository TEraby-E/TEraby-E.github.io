const test = require('node:test');
const assert = require('node:assert/strict');
const image = require('../study/export-image.js')._test;
const measure = (value, size) => Array.from(value).length * size;
const task = (overrides = {}) => ({ subject_id: 'ds', title: '链表综合题', detail: '先完成应用题，再检查指针变化。', done: false, ...overrides });

test('export validates calendar dates, including leap years', () => {
  assert.equal(image.dateValue('2028-02-29').getDate(), 29);
  assert.throws(() => image.dateValue('2026-02-29'));
  assert.throws(() => image.dateValue('2026-13-01'));
  assert.throws(() => image.dateValue('../record'));
});

test('Chinese and unbroken text wraps without losing characters', () => {
  const content = '算法题目ABCDEFG123456中文内容'.repeat(30);
  const lines = image.wrap(content, value => Array.from(value).length * 22, 820);
  assert.equal(lines.join(''), content);
  assert(lines.every(line => Array.from(line).length * 22 <= 820));
});

test('subject groups follow all eight subjects in the requested order', () => {
  const ids = ['cn', 'os', 'co', 'ds', 'probability', 'linear', 'calculus', 'english'];
  const result = image.layoutDocument(ids.map(subject_id => task({ subject_id })), measure);
  assert.deepEqual(result.tasks.map(item => item.subject_id), [...ids].reverse());
  assert.equal(result.pages.length, 1);
});

test('rest days still generate one valid image page', () => {
  const result = image.layoutDocument([], measure);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].blocks[0].type, 'rest');
  assert(result.pages[0].height >= 760);
});

test('100 long Chinese tasks paginate without trimming any details', () => {
  const long = '在处理算法问题时检查边界条件，并说明复杂度。'.repeat(70);
  const tasks = Array.from({ length: 100 }, (_, index) => task({ title: `第${index + 1}项综合题`, detail: long, done: index % 2 === 0 }));
  const result = image.layoutDocument(tasks, measure);
  assert(result.pages.length > 1);
  assert.equal(result.completed, 50);
  assert(result.pages.every(page => page.height <= image.MAX_HEIGHT));
  const allLines = result.pages.flatMap(page => page.blocks).filter(block => block.type === 'task').flatMap(block => block.lines).filter(line => line.role !== 'estimate').map(line => line.text).join('');
  for (let index = 0; index < 100; index += 1) assert(allLines.includes(`第${index + 1}项综合题${long}`));
});

test('a single exceptionally long task continues onto new pages', () => {
  const detail = '这是必须保留的完整备注内容，不能使用省略号截断。'.repeat(900);
  const result = image.layoutDocument([task({ detail })], measure);
  assert(result.pages.length > 1);
  assert(result.pages.every(page => page.blocks[0].type === 'subject'));
  assert(result.pages[1].blocks[0].continued);
  const merged = result.pages.flatMap(page => page.blocks).filter(block => block.type === 'task').flatMap(block => block.lines).filter(line => line.role !== 'estimate').map(line => line.text).join('');
  assert.equal(merged, `链表综合题${detail}`);
});

test('export time summary counts shared papers once and keeps missing estimates visible', () => {
  const assignments = [
    task({ subject_id: 'calculus', estimated_minutes: 180, estimated_source: '原计划共享整卷', estimate_group: 'shared-paper' }),
    task({ subject_id: 'linear', estimated_minutes: 180, estimated_source: '原计划共享整卷', estimate_group: 'shared-paper' }),
    task({ estimated_minutes: 35, estimated_source: '原排课预计用时' }),
    task({ subject_id: 'cn' }),
  ];
  const result = image.layoutDocument(assignments, measure);
  assert.equal(result.timeSummary.minutes, 215);
  assert.equal(result.timeSummary.unknown, 1);
  assert.equal(result.timeSummary.groups, 2);
  assert.equal(result.tasks.filter(item => item.estimate.minutes === 180).length, 2);
  const estimateLines = result.pages.flatMap(page => page.blocks).filter(block => block.type === 'task').flatMap(block => block.lines).filter(line => line.role === 'estimate').map(line => line.text).filter(Boolean);
  assert.equal(estimateLines.length, assignments.length);
  assert(estimateLines.some(label => label.includes('待补充')));
});

test('old records recover canonical estimates while saved estimates retain their snapshot', () => {
  const canonical = { id: 'source-task', estimated_minutes: 75, estimated_source: '原排课预计用时', estimate_group: 'source-group' };
  const library = { subjects: [{ chapters: [{ tasks: [canonical] }] }] };
  const old = task({ task_id: canonical.id, title: '已归档标题', detail: '已归档备注' });
  const recovered = image.hydrateEstimates([old], library)[0];
  assert.equal(recovered.estimated_minutes, 75);
  assert.equal(recovered.estimate_group, 'source-group');
  assert.equal(recovered.title, old.title);
  assert.equal(recovered.detail, old.detail);
  const snapshot = image.hydrateEstimates([{ ...old, estimated_minutes: 45, estimated_source: '保存时的预计用时', estimate_group: 'source-group' }], library)[0];
  assert.equal(snapshot.estimated_minutes, 45);
  assert.equal(image.layoutDocument([snapshot], measure).timeSummary.minutes, 45);
});

test('estimated video time remains explicitly labelled as video time', () => {
  const result = image.layoutDocument([task({ estimated_minutes: 12, estimated_source: '原视频时长' })], measure);
  assert.equal(result.timeSummary.minutes, 12);
  assert(result.tasks[0].estimate.label.includes('视频时长'));
});

test('actual zero is recorded while pending or missing actual time is never invented', () => {
  const result = image.layoutDocument([
    task({ task_id: 'zero', estimated_minutes: 20, actual_minutes: 0, done: true }),
    task({ task_id: 'missing', estimated_minutes: 30, done: true }),
    task({ task_id: 'pending', estimated_minutes: 40, actual_minutes: 15, done: false }),
  ], measure);
  assert.equal(result.timeSummary.minutes, 90);
  assert.equal(result.timeSummary.actualMinutes, 0);
  assert.equal(result.timeSummary.actualKnown, 1);
  assert.equal(result.timeSummary.actualUnknown, 1);
  assert.equal(result.tasks[0].actual.minutes, 0);
  assert.equal(result.tasks[0].actual.recorded, true);
  assert.equal(result.tasks[1].actual.minutes, null);
  assert.equal(result.tasks[2].actual.minutes, null);
  assert(result.tasks[0].timeComparison.includes('预计20分钟'));
  assert(result.tasks[0].timeComparison.includes('实际0分钟'));
  assert(result.tasks[1].timeComparison.includes('实际未记录'));
  assert(result.tasks[2].timeComparison.includes('实际待完成'));
});

test('shared task copies export actual duration only once without losing each record', () => {
  const assignments = ['calculus', 'linear', 'probability'].map((subject_id, index) => task({
    task_id: `paper-${index}`, subject_id, estimated_minutes: 180,
    estimate_group: 'shared-paper', actual_minutes: 200, done: true,
  }));
  const result = image.layoutDocument(assignments, measure);
  assert.equal(result.timeSummary.minutes, 180);
  assert.equal(result.timeSummary.actualMinutes, 200);
  assert.equal(result.timeSummary.actualUnknown, 0);
  assert.equal(result.tasks.length, 3);
  assert(result.tasks.every(item => item.actual.minutes === 200));
  const lines = result.pages.flatMap(page => page.blocks).filter(block => block.type === 'task').flatMap(block => block.lines).filter(line => line.role === 'estimate').map(line => line.text).join('');
  assert.equal(lines.match(/实际3小时20分钟/g).length, 3);
});

test('retired selectable cards still supply estimates to an old saved record without fabricating actual time', () => {
  const library = { subjects: [], metadata: { retired_tasks: [{ id: 'retired', estimated_minutes: 35, estimated_source: '原计划', estimate_group: 'retired' }] } };
  const old = task({ task_id: 'retired', title: '以前保存的任务', detail: '以前保存的笔记', done: true, actual_minutes: 22 });
  const recovered = image.hydrateEstimates([old], library)[0];
  assert.equal(recovered.estimated_minutes, 35);
  assert.equal(recovered.actual_minutes, 22);
  assert.equal(recovered.title, old.title);
  assert.equal(recovered.detail, old.detail);
  const noActual = image.hydrateEstimates([task({ task_id: 'retired', done: true })], library)[0];
  assert.equal(Object.hasOwn(noActual, 'actual_minutes'), false);
  assert.equal(image.layoutDocument([noActual], measure).timeSummary.actualUnknown, 1);
});

test('export retains metadata and nonduplicate remarks', () => {
  const result = image.layoutDocument([task({ kind: '应用题', quantity: '3题', reference: '3.2', remarks: '注意临界指针' })], measure);
  const text = result.pages.flatMap(page => page.blocks).filter(block => block.type === 'task').flatMap(block => block.lines).map(line => line.text).join('');
  assert(text.includes('任务类型：应用题'));
  assert(text.includes('任务量：3题'));
  assert(text.includes('参考：3.2'));
  assert(text.includes('注意临界指针'));
});

test('ZIP stores UTF-8 PNG names and valid CRC data', async () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(image.crc32(bytes), 0xCBF43926);
  const archive = await image.zipFiles([{ name: '今日打卡_2026-10-25_p1.png', blob: new Blob([bytes]) }, { name: '第二张.png', blob: new Blob(['PNG']) }]);
  const data = new Uint8Array(await archive.arrayBuffer());
  const view = new DataView(data.buffer);
  assert.equal(view.getUint32(0, true), 0x04034B50);
  assert.equal(view.getUint16(6, true), 0x0800);
  assert.equal(view.getUint32(data.length - 22, true), 0x06054B50);
  assert.equal(view.getUint16(data.length - 12, true), 2);
  assert(new TextDecoder().decode(data).includes('第二张.png'));
});
