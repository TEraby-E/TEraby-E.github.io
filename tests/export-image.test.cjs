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
  const allLines = result.pages.flatMap(page => page.blocks).filter(block => block.type === 'task').flatMap(block => block.lines).map(line => line.text).join('');
  for (let index = 0; index < 100; index += 1) assert(allLines.includes(`第${index + 1}项综合题${long}`));
});

test('a single exceptionally long task continues onto new pages', () => {
  const detail = '这是必须保留的完整备注内容，不能使用省略号截断。'.repeat(900);
  const result = image.layoutDocument([task({ detail })], measure);
  assert(result.pages.length > 1);
  assert(result.pages.every(page => page.blocks[0].type === 'subject'));
  assert(result.pages[1].blocks[0].continued);
  const merged = result.pages.flatMap(page => page.blocks).filter(block => block.type === 'task').flatMap(block => block.lines).map(line => line.text).join('');
  assert.equal(merged, `链表综合题${detail}`);
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
