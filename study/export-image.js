'use strict';

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyImage = api;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  const WIDTH = 1200;
  const MAX_HEIGHT = 12000;
  const CONTENT_TOP = 448;
  const FOOTER = 88;
  const SUBJECT_HEIGHT = 56;
  const PAD = 22;
  const TEXT_WIDTH = 820;
  const SUBJECTS = Object.freeze({ english: '英语', calculus: '高数', linear: '线代', probability: '概率论', ds: '数据结构', co: '计组', os: '操作系统', cn: '计网' });
  const ORDER = Object.keys(SUBJECTS);
  const COLORS = { paper: '#F3EBDD', row: '#FCF7EE', rowAlt: '#F7EFE2', ink: '#282126', muted: '#81736E', red: '#A51C30', wine: '#622C3D', rule: '#DFD0C0', pink: '#E5A8B6', green: '#537C66' };
  const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
  const scope = root.document ? new URL('.', root.document.baseURI).pathname : '/';
  const DB_NAME = `sjtu-study-export:${scope}`;
  let directoryHandle;
  let crestPromise;
  let exportQueue = Promise.resolve();

  function dateValue(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('导出日期格式不正确。');
    const [year, month, day] = date.split('-').map(Number);
    const value = new Date(0);
    value.setFullYear(year, month - 1, day);
    value.setHours(12, 0, 0, 0);
    if (year < 1 || value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day) throw new Error('导出日期不是有效的日历日期。');
    return value;
  }

  function clean(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').split('\n').map(line => line.replace(/[\t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function normalize(assignments) {
    if (!Array.isArray(assignments) || assignments.length > 100) throw new Error('导出任务列表格式不正确，单日最多支持 100 项任务。');
    return assignments.map((task, index) => {
      if (!task || typeof task !== 'object' || !Object.hasOwn(SUBJECTS, task.subject_id)) throw new Error(`第 ${index + 1} 项任务的科目不正确。`);
      if (typeof (task.done ?? false) !== 'boolean') throw new Error(`第 ${index + 1} 项任务的打卡状态不正确。`);
      const title = clean(task.title);
      if (!title) throw new Error(`第 ${index + 1} 项任务缺少标题。`);
      const chapter = clean(task.chapter_title);
      const detail = clean(task.detail);
      const remarks = clean(task.remarks);
      const metadata = [['任务类型', task.kind], ['任务量', task.quantity], ['参考', task.reference]].map(([label, value]) => [label, clean(value)]).filter(([label, value]) => value && !detail.includes(`${label}：${value}`));
      return {
        subject_id: task.subject_id, subject_name: SUBJECTS[task.subject_id], title,
        chapter: chapter && !title.includes(chapter) ? chapter : '',
        detail, remarks: remarks && !detail.includes(remarks) && remarks !== title ? remarks : '',
        metadata: metadata.map(([label, value]) => `${label}：${value}`).join('  ·  '),
        done: task.done ?? false, originalIndex: index,
      };
    }).sort((a, b) => ORDER.indexOf(a.subject_id) - ORDER.indexOf(b.subject_id) || a.originalIndex - b.originalIndex);
  }

  function wrap(text, measure, width = TEXT_WIDTH) {
    const result = [];
    for (const paragraph of String(text).split('\n')) {
      if (!paragraph) { result.push(''); continue; }
      let line = '';
      for (const character of Array.from(paragraph)) {
        const candidate = line + character;
        if (line && measure(candidate) > width) { result.push(line); line = character; }
        else line = candidate;
      }
      if (line) result.push(line);
    }
    return result;
  }

  function taskLines(task, measure) {
    const lines = [];
    const add = (text, size, height, color, bold, gap = 0) => {
      if (!text) return;
      if (gap) lines.push({ text: '', size: 1, height: gap, color, bold: false });
      for (const line of wrap(text, value => measure(value, size, bold))) lines.push({ text: line, size, height, color, bold });
    };
    add(task.title, 27, 40, COLORS.ink, true);
    add(task.chapter, 19, 29, COLORS.wine, false, 5);
    add(task.metadata, 18, 28, COLORS.wine, false, 6);
    add(task.detail, 22, 34, COLORS.muted, false, 8);
    add(task.remarks, 22, 34, COLORS.muted, false, 5);
    return lines;
  }

  function layoutDocument(assignments, measure) {
    const tasks = normalize(assignments);
    const pages = [];
    let page;
    let y;
    let subjectId;
    const fresh = () => { page = { blocks: [], height: 0 }; pages.push(page); y = CONTENT_TOP; subjectId = null; };
    fresh();
    const addSubject = (task, continued) => {
      page.blocks.push({ type: 'subject', top: y, height: SUBJECT_HEIGHT, name: task.subject_name, continued });
      y += SUBJECT_HEIGHT;
      subjectId = task.subject_id;
    };
    const finish = () => { page.height = Math.max(760, Math.ceil(y + FOOTER)); };
    for (const task of tasks) {
      const lines = taskLines(task, measure);
      let at = 0;
      let continued = false;
      const fullHeight = PAD * 2 + lines.reduce((sum, line) => sum + line.height, 0);
      const freshCapacity = MAX_HEIGHT - FOOTER - CONTENT_TOP - SUBJECT_HEIGHT;
      const head = subjectId === task.subject_id ? 0 : SUBJECT_HEIGHT;
      if (y + head + fullHeight > MAX_HEIGHT - FOOTER && fullHeight <= freshCapacity && page.blocks.length) {
        finish(); fresh();
      }
      while (at < lines.length) {
        const headHeight = subjectId === task.subject_id ? 0 : SUBJECT_HEIGHT;
        const minLineHeight = lines[at].height + (lines[at].text ? 0 : lines[at + 1]?.height || 0);
        if (y + headHeight + PAD * 2 + minLineHeight > MAX_HEIGHT - FOOTER && page.blocks.length) { finish(); fresh(); }
        if (subjectId !== task.subject_id) addSubject(task, continued);
        const capacity = MAX_HEIGHT - FOOTER - y - PAD * 2;
        let used = 0;
        let end = at;
        while (end < lines.length && used + lines[end].height <= capacity) { used += lines[end].height; end += 1; }
        if (end === at) throw new Error('任务文字无法放入导出图片，请检查异常字体设置。');
        page.blocks.push({ type: 'task', top: y, height: used + PAD * 2, lines: lines.slice(at, end), done: task.done, continued, subject_id: task.subject_id, originalIndex: task.originalIndex });
        y += used + PAD * 2;
        at = end;
        if (at < lines.length) { finish(); fresh(); continued = true; }
      }
    }
    if (!tasks.length) { page.blocks.push({ type: 'rest', top: CONTENT_TOP, height: 194 }); y += 194; }
    finish();
    return { pages, tasks, width: WIDTH, completed: tasks.filter(task => task.done).length };
  }

  function font(context, size, bold = false) { context.font = `${bold ? 650 : 400} ${size}px ${FONT}`; }
  function text(context, value, x, y, size, color, bold = false, align = 'left') {
    font(context, size, bold); context.textAlign = align; context.textBaseline = 'top'; context.fillStyle = color; context.fillText(value, x, y);
  }
  function rounded(context, x, y, w, h, radius, fill, stroke) {
    context.beginPath(); context.roundRect(x, y, w, h, radius);
    if (fill) { context.fillStyle = fill; context.fill(); }
    if (stroke) { context.strokeStyle = stroke; context.lineWidth = 1; context.stroke(); }
  }
  function line(context, x1, y1, x2, y2, color, width = 1) {
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.strokeStyle = color; context.lineWidth = width; context.stroke();
  }
  function status(context, x, y, done) {
    context.beginPath(); context.arc(x + 14, y + 14, 14, 0, Math.PI * 2);
    if (done) { context.fillStyle = COLORS.green; context.fill(); line(context, x + 7, y + 14, x + 12, y + 19, '#FFFAF0', 3); line(context, x + 12, y + 19, x + 22, y + 8, '#FFFAF0', 3); }
    else { context.strokeStyle = '#BBAA9D'; context.lineWidth = 2; context.stroke(); }
  }

  function drawHeader(context, day, document, pageNumber, crest) {
    context.fillStyle = COLORS.paper; context.fillRect(0, 0, WIDTH, context.canvas.height);
    const gradient = context.createLinearGradient(0, 0, WIDTH, 270);
    gradient.addColorStop(0, '#211D23'); gradient.addColorStop(0.65, '#3D2030'); gradient.addColorStop(1, '#74273E');
    context.fillStyle = gradient; context.fillRect(0, 0, WIDTH, 272);
    for (let x = 0; x <= WIDTH; x += 40) line(context, x, 8, x, 272, '#FFFFFF07');
    for (let y = 8; y <= 272; y += 40) line(context, 0, y, WIDTH, y, '#FFFFFF07');
    context.fillStyle = COLORS.red; context.fillRect(0, 0, WIDTH, 8);
    text(context, '上海交通大学', 76, 57, 26, '#FFF4E9', true);
    text(context, 'SJTU', 77, 99, 15, '#D0BCC2', true);
    text(context, '饮水思源 · 爱国荣校', 73, 148, 55, '#FFF8EE', true);
    text(context, '不要把梦想埋没', 78, 225, 18, COLORS.pink, true);
    rounded(context, 1003, 50, 121, 121, 9, '#FFFFFF');
    context.drawImage(crest, 1011, 58, 105, 105);
    const formatted = `${day.getFullYear()}.${String(day.getMonth() + 1).padStart(2, '0')}.${String(day.getDate()).padStart(2, '0')}`;
    text(context, formatted, 76, 315, 39, COLORS.ink, true);
    text(context, `星期${'日一二三四五六'[day.getDay()]}`, 78, 372, 20, COLORS.muted);
    rounded(context, 752, 307, 372, 102, 13, '#FAF3E8', COLORS.rule);
    text(context, '今日进度', 777, 329, 19, COLORS.muted);
    text(context, String(document.completed).padStart(2, '0'), 904, 322, 39, COLORS.red, true);
    text(context, `/ ${String(document.tasks.length).padStart(2, '0')} 项`, 987, 341, 21, COLORS.ink);
    rounded(context, 777, 382, 320, 5, 2.5, '#E5D7C9');
    if (document.tasks.length && document.completed) rounded(context, 777, 382, Math.max(5, 320 * document.completed / document.tasks.length), 5, 2.5, COLORS.red);
    line(context, 76, 428, 1124, 428, '#D5B9B8', 1.5);
    text(context, `${pageNumber} / ${document.pages.length}`, 1124, 239, 16, '#DAC0C9', false, 'right');
  }

  function drawPage(context, document, page, day, number, crest) {
    drawHeader(context, day, document, number, crest);
    for (const block of page.blocks) {
      if (block.type === 'subject') {
        rounded(context, 76, block.top, 1048, block.height, 0, COLORS.wine);
        text(context, block.name + (block.continued ? ' · 续' : ''), 102, block.top + 15, 24, '#F9EBDD', true);
      } else if (block.type === 'rest') {
        rounded(context, 76, block.top, 1048, block.height, 12, COLORS.row, COLORS.rule);
        text(context, '今天没有安排学习任务', 110, block.top + 43, 29, COLORS.ink, true);
        text(context, '休息与调整，也是学习计划的一部分。', 111, block.top + 103, 23, COLORS.muted);
      } else {
        context.fillStyle = block.originalIndex % 2 ? COLORS.rowAlt : COLORS.row;
        context.fillRect(76, block.top, 1048, block.height);
        line(context, 76, block.top + block.height, 1124, block.top + block.height, COLORS.rule);
        line(context, 76, block.top, 76, block.top + block.height, COLORS.rule);
        line(context, 1124, block.top, 1124, block.top + block.height, COLORS.rule);
        status(context, 100, block.top + PAD + 4, block.done);
        text(context, block.continued ? '续' : block.done ? '已完成' : '待完成', 1098, block.top + PAD + 8, 17, block.done ? COLORS.green : COLORS.muted, false, 'right');
        let y = block.top + PAD;
        for (const item of block.lines) { if (item.text) text(context, item.text, 148, y, item.size, item.color, item.bold); y += item.height; }
      }
    }
    const footerY = page.height - 54;
    line(context, 76, footerY - 20, 1124, footerY - 20, COLORS.rule);
    text(context, '饮水思源  ·  爱国荣校', 76, footerY, 19, COLORS.red, true);
    text(context, `一日一记，学有所进。  ${number} / ${document.pages.length}`, 1124, footerY + 1, 18, COLORS.muted, false, 'right');
  }

  function getCrest() {
    if (!crestPromise) crestPromise = new Promise((resolve, reject) => {
      const image = new root.Image();
      image.onload = () => resolve(image);
      image.onerror = () => { crestPromise = null; reject(new Error('校徽图片未载入，请联网重新打开页面后导出。')); };
      image.src = new URL('./assets/sjtu-emblem.png', root.document.baseURI).href;
    });
    return crestPromise;
  }

  function settings(action, value) {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('当前浏览器不能记住导出目录。')); return; }
      const open = root.indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => { open.result.createObjectStore('preferences'); };
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('导出目录设置暂时被其他窗口占用。'));
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('preferences', action === 'get' ? 'readonly' : 'readwrite');
        const store = transaction.objectStore('preferences');
        const request = action === 'get' ? store.get('directory') : action === 'delete' ? store.delete('directory') : store.put(value, 'directory');
        let result;
        request.onsuccess = () => { result = request.result; };
        transaction.oncomplete = () => { db.close(); resolve(result); };
        transaction.onerror = () => { db.close(); reject(transaction.error || new Error('导出目录设置未保存。')); };
        transaction.onabort = () => { db.close(); reject(transaction.error || new Error('导出目录设置未保存。')); };
      };
    });
  }

  async function rememberedDirectory() {
    if (directoryHandle === undefined) {
      try { directoryHandle = (await settings('get')) || null; } catch { directoryHandle = null; }
    }
    return directoryHandle;
  }

  async function getDirectoryInfo() {
    const supported = typeof root.showDirectoryPicker === 'function' && root.isSecureContext;
    const handle = supported ? await rememberedDirectory() : null;
    return { supported: Boolean(supported), configured: Boolean(handle), name: handle?.name || '' };
  }

  async function chooseDirectory() {
    if (typeof root.showDirectoryPicker !== 'function' || !root.isSecureContext) return { supported: false, configured: false, name: '', cancelled: false };
    let handle;
    try { handle = await root.showDirectoryPicker({ id: 'sjtu-study-export', mode: 'readwrite', startIn: 'desktop' }); }
    catch (error) { if (error.name === 'AbortError') return { ...(await getDirectoryInfo()), cancelled: true }; throw new Error(`未能选择导出目录：${error.message}`); }
    directoryHandle = handle;
    let warning;
    try { await settings('put', handle); } catch { warning = '这个目录本次可以使用，但浏览器未能记住它；下次需要重新选择。'; }
    return { supported: true, configured: true, name: handle.name, cancelled: false, warning };
  }

  async function clearDirectory() { await settings('delete'); directoryHandle = null; return getDirectoryInfo(); }

  async function permittedDirectory() {
    const handle = await rememberedDirectory();
    if (!handle) return { handle: null };
    try {
      let permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted' && root.navigator?.userActivation?.isActive) permission = await handle.requestPermission({ mode: 'readwrite' });
      if (permission === 'granted') return { handle };
    } catch { /* A revoked folder handle must not prevent a regular download. */ }
    return { handle: null, warning: '导出目录暂未授权，已改为浏览器下载。需要保存到桌面时，请重新选择导出目录。' };
  }

  async function uniqueFile(handle, desired) {
    const stem = desired.replace(/\.png$/i, '');
    for (let collision = 0; collision < 10000; collision += 1) {
      const name = collision ? `${stem}_${collision + 1}.png` : desired;
      try { await handle.getFileHandle(name); }
      catch (error) { if (error.name === 'NotFoundError') return { name, handle: await handle.getFileHandle(name, { create: true }) }; throw error; }
    }
    throw new Error('同名图片过多，请整理导出目录后重试。');
  }

  function download(blob, name) {
    const url = root.URL.createObjectURL(blob);
    const anchor = root.document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.hidden = true;
    root.document.body.append(anchor); anchor.click(); anchor.remove();
    root.setTimeout(() => root.URL.revokeObjectURL(url), 60000);
  }

  const crcTable = Array.from({ length: 256 }, (_, n) => { let value = n; for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
  function crc32(bytes) { let crc = 0xFFFFFFFF; for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0; }
  function binary(size) { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; }
  async function zipFiles(files) {
    const local = [];
    const central = [];
    let offset = 0;
    for (const file of files) {
      const data = new Uint8Array(await file.blob.arrayBuffer());
      const name = new TextEncoder().encode(file.name);
      const crc = crc32(data);
      const header = binary(30 + name.length);
      header.view.setUint32(0, 0x04034B50, true); header.view.setUint16(4, 20, true); header.view.setUint16(6, 0x0800, true);
      header.view.setUint32(14, crc, true); header.view.setUint32(18, data.length, true); header.view.setUint32(22, data.length, true); header.view.setUint16(26, name.length, true); header.bytes.set(name, 30);
      local.push(header.bytes, data);
      const entry = binary(46 + name.length);
      entry.view.setUint32(0, 0x02014B50, true); entry.view.setUint16(4, 20, true); entry.view.setUint16(6, 20, true); entry.view.setUint16(8, 0x0800, true);
      entry.view.setUint32(16, crc, true); entry.view.setUint32(20, data.length, true); entry.view.setUint32(24, data.length, true); entry.view.setUint16(28, name.length, true); entry.view.setUint32(42, offset, true); entry.bytes.set(name, 46);
      central.push(entry.bytes); offset += header.bytes.length + data.length;
    }
    const centralSize = central.reduce((sum, bytes) => sum + bytes.length, 0);
    const end = binary(22);
    end.view.setUint32(0, 0x06054B50, true); end.view.setUint16(8, files.length, true); end.view.setUint16(10, files.length, true); end.view.setUint32(12, centralSize, true); end.view.setUint32(16, offset, true);
    return new Blob([...local, ...central, end.bytes], { type: 'application/zip' });
  }

  async function performExport({ date, assignments }) {
    const day = dateValue(date);
    const permission = await permittedDirectory();
    if (root.document.fonts?.ready) await root.document.fonts.ready;
    const crest = await getCrest();
    const canvas = root.document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建图片画布，请换用新版浏览器后重试。');
    const document = layoutDocument(assignments, (value, size, bold) => { font(context, size, bold); return context.measureText(value).width; });
    const files = [];
    try {
      for (let i = 0; i < document.pages.length; i += 1) {
        const page = document.pages[i];
        canvas.width = WIDTH; canvas.height = page.height;
        drawPage(context, document, page, day, i + 1, crest);
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('浏览器未能生成 PNG 图片，请减少单日任务后重试。')), 'image/png'));
        const suffix = document.pages.length > 1 ? `_p${i + 1}` : '';
        files.push({ name: `今日打卡_${date}${suffix}.png`, blob, width: WIDTH, height: page.height });
        canvas.width = canvas.height = 1;
      }
    } finally { canvas.width = canvas.height = 1; }
    if (permission.handle) {
      const write = async () => {
        let saved = 0;
        try {
          for (const file of files) {
            const target = await uniqueFile(permission.handle, file.name);
            const writable = await target.handle.createWritable();
            try { await writable.write(file.blob); await writable.close(); }
            catch (error) { await writable.abort().catch(() => {}); throw error; }
            file.name = target.name; saved += 1;
          }
        } catch (error) { throw new Error(`${saved ? `已有 ${saved} 张图片保存，` : ''}其余图片未能写入“${permission.handle.name}”：${error.message}。请检查目录权限或改用浏览器下载。`); }
      };
      if (root.navigator?.locks?.request) await root.navigator.locks.request(`sjtu-study-image:${scope}`, write);
      else await write();
      return { files, destination: 'directory', directoryName: permission.handle.name };
    }
    let archiveName;
    if (files.length > 1) { archiveName = `今日打卡_${date}_全部图片.zip`; download(await zipFiles(files), archiveName); }
    else download(files[0].blob, files[0].name);
    return { files, destination: 'download', archiveName, warning: permission.warning };
  }

  function exportDaily(value) {
    const run = exportQueue.then(() => performExport(value));
    exportQueue = run.catch(() => {});
    return run;
  }

  return { exportDaily, chooseDirectory, getDirectoryInfo, clearDirectory, _test: { normalize, wrap, layoutDocument, dateValue, crc32, zipFiles, WIDTH, MAX_HEIGHT } };
});
