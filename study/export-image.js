'use strict';

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyImage = api;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  const WIDTH = 1200;
  const SCALE = 2;
  const MAX_HEIGHT = 6000;
  const CONTENT_TOP = 448;
  const FOOTER = 88;
  const SUBJECT_HEIGHT = 68;
  const CARD_HEADER = 50;
  const CARD_GAP = 18;
  const PAD = 22;
  const TEXT_WIDTH = 952;
  const SUBJECTS = Object.freeze({ english: '英语', calculus: '高数', linear: '线代', probability: '概率论', ds: 'DS', co: 'CO', os: 'OS', cn: 'CN' });
  const ORDER = Object.keys(SUBJECTS);
  const COLORS = { paper: '#F3EBDD', row: '#FCF7EE', rowAlt: '#F7EFE2', ink: '#282126', muted: '#594D44', red: '#A51C30', wine: '#622C3D', rule: '#DFD0C0', pink: '#E5A8B6', green: '#537C66' };
  const FONT = '"Times New Roman", "SimSun", "宋体", "Songti SC", "Noto Serif CJK SC", serif';
  const scope = root.document ? new URL('.', root.document.baseURI).pathname : '/';
  const DB_NAME = `sjtu-study-export:${scope}`;
  let directoryHandle;
  let crestPromise;
  let exportQueue = Promise.resolve();
  let exportFontFamily = FONT;
  const contextFonts = new WeakMap();

  function timeTools() {
    if (root.StudyTime) return root.StudyTime;
    if (typeof module === 'object' && module.exports) return require('./study-time.js');
    throw new Error('预计时长模块没有载入，请刷新页面后重试。');
  }

  function hydrateEstimates(assignments, library) {
    const canonical = new Map();
    for (const subject of library?.subjects || library || []) {
      for (const chapter of subject.chapters || []) for (const task of chapter.tasks || []) canonical.set(task.id, task);
    }
    for (const task of library?.metadata?.retired_tasks || []) if (!canonical.has(task.id)) canonical.set(task.id, task);
    return assignments.map((task) => {
      const estimate = timeTools().getEstimate(task, canonical.get(task.task_id || task.id));
      return { ...task, estimated_minutes: estimate.minutes, estimated_source: estimate.source, estimate_group: estimate.group };
    });
  }

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
    return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').split('\n').map(line => line.replace(/[\t ]+/g, ' ').trim()).join('\n').replace(/\n{2,}/g, '\n').trim();
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
      const estimate = timeTools().getEstimate(task);
      const actual = timeTools().getActual(task);
      const metadata = [['任务类型', task.kind], ['任务量', task.quantity], ['参考', task.reference]].map(([label, value]) => [label, clean(value)]).filter(([label, value]) => value && !detail.includes(`${label}：${value}`));
      return {
        subject_id: task.subject_id, subject_name: SUBJECTS[task.subject_id], title,
        chapter: chapter && !title.includes(chapter) ? chapter : '',
        detail: detail.replace(/\s/g, '') === title.replace(/\s/g, '') ? '' : detail, remarks: remarks && !detail.includes(remarks) && remarks !== title ? remarks : '',
        metadata: metadata.map(([label, value]) => `${label}：${value}`).join('  ·  '),
        estimate, actual, timeComparison: timeTools().comparisonLabel(task),
        done: task.done ?? false, originalIndex: index,
        mode: task.task_mode === 'multi-day' ? 'multi-day' : 'single-day',
        overallCompleted: typeof task.overall_completed === 'boolean' ? task.overall_completed : task.task_mode === 'multi-day' ? false : Boolean(task.done),
        checkinDays: Number.isFinite(task.checkin_days) ? Math.max(0, Math.floor(task.checkin_days)) : task.done ? 1 : 0,
        totalActualMinutes: Number.isFinite(task.total_actual_minutes) ? Math.max(0, task.total_actual_minutes) : 0,
        exportContext: task.export_context || 'daily',
      };
    }).sort((a, b) => ORDER.indexOf(a.subject_id) - ORDER.indexOf(b.subject_id) || Number(a.overallCompleted) - Number(b.overallCompleted) || a.originalIndex - b.originalIndex);
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
    const add = (text, size, height, color, bold, gap = 0, role = 'content') => {
      if (!text) return;
      if (gap) lines.push({ text: '', size: 1, height: gap, color, bold: false, role });
      for (const line of wrap(text, value => measure(value, size, bold))) lines.push({ text: line, size, height, color, bold, role });
    };
    add(task.chapter, 21, 32, COLORS.wine, false);
    add(task.title, 28, 43, COLORS.ink, true, task.chapter ? 4 : 0);
    add(task.detail, 25, 39, COLORS.muted, false, 8);
    add(task.metadata, 21, 33, COLORS.wine, false, 6);
    add(task.remarks ? `学习备注：${task.remarks}` : '', 25, 39, COLORS.muted, false, 7);
    lines.push({ text: task.timeComparison, size: 21, height: 122, color: COLORS.wine, bold: false, role: 'estimate' });
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
      const fullHeight = PAD * 2 + CARD_HEADER + lines.reduce((sum, line) => sum + line.height, 0) + CARD_GAP;
      const freshCapacity = MAX_HEIGHT - FOOTER - CONTENT_TOP - SUBJECT_HEIGHT;
      const head = subjectId === task.subject_id ? 0 : SUBJECT_HEIGHT;
      if (y + head + fullHeight > MAX_HEIGHT - FOOTER && fullHeight <= freshCapacity && page.blocks.length) {
        finish(); fresh();
      }
      while (at < lines.length) {
        const headHeight = subjectId === task.subject_id ? 0 : SUBJECT_HEIGHT;
        const minLineHeight = lines[at].height + (lines[at].text ? 0 : lines[at + 1]?.height || 0);
        if (y + headHeight + PAD * 2 + CARD_HEADER + CARD_GAP + minLineHeight > MAX_HEIGHT - FOOTER && page.blocks.length) { finish(); fresh(); }
        if (subjectId !== task.subject_id) addSubject(task, continued);
        const capacity = MAX_HEIGHT - FOOTER - y - PAD * 2 - CARD_HEADER - CARD_GAP;
        let used = 0;
        let end = at;
        while (end < lines.length && used + lines[end].height <= capacity) { used += lines[end].height; end += 1; }
        if (end === at) throw new Error('任务文字无法放入导出图片，请检查异常字体设置。');
        page.blocks.push({ type: 'task', top: y, height: used + PAD * 2 + CARD_HEADER, task, lines: lines.slice(at, end), done: task.done, continued, subject_id: task.subject_id, originalIndex: task.originalIndex });
        y += used + PAD * 2 + CARD_HEADER + CARD_GAP;
        at = end;
        if (at < lines.length) { finish(); fresh(); continued = true; }
      }
    }
    if (!tasks.length) { page.blocks.push({ type: 'rest', top: CONTENT_TOP, height: 194 }); y += 194; }
    finish();
    return { pages, tasks, width: WIDTH, completed: tasks.filter(task => task.done).length, timeSummary: timeTools().summarize(assignments) };
  }

  async function prepareTypography() {
    if (!root.document) return;
    if (root.getComputedStyle) {
      const style = root.getComputedStyle(root.document.documentElement);
      exportFontFamily = style.fontFamily || FONT;
      COLORS.ink = style.getPropertyValue('--card-title-ink').trim() || '#302827';
      COLORS.muted = style.getPropertyValue('--card-body-ink').trim() || '#594D44';
      COLORS.red = style.getPropertyValue('--red').trim() || COLORS.red;
      COLORS.green = style.getPropertyValue('--green').trim() || COLORS.green;
    }
    if (root.document.fonts?.load) {
      const sample = '学习任务 时间 ABC DS CO OS CN 0123456789 ,.;:!?';
      await Promise.all([400, 700].map((weight) => root.document.fonts.load(`${weight} 28px ${exportFontFamily}`, sample)));
    }
    if (root.document.fonts?.ready) await root.document.fonts.ready;
  }

  function prepareContext(context, scale = 1) {
    context.setTransform(scale, 0, 0, scale, 0, 0);
    contextFonts.delete(context);
    if ('fontKerning' in context) context.fontKerning = 'normal';
    if ('textRendering' in context) context.textRendering = 'optimizeLegibility';
    if ('letterSpacing' in context) context.letterSpacing = '0px';
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
  }

  function font(context, size, bold = false) {
    const value = `${bold ? 700 : 400} ${size}px ${exportFontFamily}`;
    if (contextFonts.get(context) !== value) { context.font = value; contextFonts.set(context, value); }
  }

  function yieldToBrowser() {
    if (root.scheduler?.yield) return root.scheduler.yield();
    return new Promise((resolve) => root.setTimeout(resolve, 0));
  }
  function text(context, value, x, y, size, color, bold = false, align = 'left') {
    font(context, size, bold); context.textAlign = align; context.textBaseline = 'top'; context.fillStyle = color; context.fillText(value, x, y);
  }
  function fittedText(context, value, x, y, size, maxWidth, color, bold = false, minSize = 12) {
    let fitted = size;
    font(context, fitted, bold);
    while (fitted > minSize && context.measureText(value).width > maxWidth) { fitted -= 1; font(context, fitted, bold); }
    text(context, value, x, y, fitted, color, bold);
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
    text(context, '交大学习手账', 76, 57, 26, '#FFF4E9', true);
    text(context, 'SJTU', 77, 99, 15, '#D0BCC2', true);
    text(context, '饮水思源 · 爱国荣校', 73, 148, 55, '#FFF8EE', true);
    text(context, '不要把梦想埋没', 78, 225, 18, COLORS.pink, true);
    context.drawImage(crest, 1003, 50, 121, 121);
    const formatted = `${day.getFullYear()}.${String(day.getMonth() + 1).padStart(2, '0')}.${String(day.getDate()).padStart(2, '0')}`;
    const summary = document.timeSummary;
    rounded(context, 76, 307, 300, 102, 13, '#FAF3E8', COLORS.rule);
    text(context, '今日学习时长 · 预计 / 实际', 98, 319, 15, COLORS.muted);
    const duration = summary.unknown && !summary.known ? '待补充' : timeTools().formatMinutes(summary.minutes);
    const actualDuration = summary.actualUnknown && !summary.actualKnown ? '待补记' : timeTools().formatMinutes(summary.actualMinutes);
    const estimateText = `${duration}${summary.unknown ? ` · ${summary.unknown}项待补` : ''}`;
    const actualText = `${actualDuration}${summary.actualUnknown ? ` · ${summary.actualUnknown}项未记` : ''}`;
    text(context, '预计', 98, 347, 14, COLORS.muted);
    fittedText(context, estimateText, 143, 342, 22, 211, COLORS.red, true);
    text(context, '实际', 98, 378, 14, COLORS.muted);
    fittedText(context, actualText, 143, 373, 22, 211, COLORS.green, true);
    text(context, formatted, 418, 324, 31, COLORS.ink, true);
    text(context, `星期${'日一二三四五六'[day.getDay()]}`, 420, 373, 19, COLORS.muted);
    rounded(context, 752, 307, 372, 102, 13, '#FAF3E8', COLORS.rule);
    text(context, '今日进度', 777, 329, 19, COLORS.muted);
    text(context, String(document.completed).padStart(2, '0'), 904, 322, 39, COLORS.red, true);
    text(context, `/ ${String(document.tasks.length).padStart(2, '0')} 项`, 987, 341, 21, COLORS.ink);
    rounded(context, 777, 382, 320, 5, 2.5, '#E5D7C9');
    if (document.tasks.length && document.completed) rounded(context, 777, 382, Math.max(5, 320 * document.completed / document.tasks.length), 5, 2.5, COLORS.red);
    line(context, 76, 428, 1124, 428, '#D5B9B8', 1.5);
    text(context, `${pageNumber} / ${document.pages.length}`, 1124, 239, 16, '#DAC0C9', false, 'right');
  }

  class ImageCard {
    constructor(context, block) {
      this.context = context;
      this.block = block;
      this.x = 76;
      this.width = 1048;
    }

    frame(fill, border, radius = 16) {
      const context = this.context;
      context.save();
      context.shadowColor = '#4A2C2410'; context.shadowBlur = 12; context.shadowOffsetY = 4;
      rounded(context, this.x, this.block.top, this.width, this.block.height, radius, fill);
      context.restore();
      rounded(context, this.x, this.block.top, this.width, this.block.height, radius, null, border);
    }

    badge(label, x, y, fill, ink) {
      font(this.context, 21);
      const width = this.context.measureText(label).width + 22;
      rounded(this.context, x, y, width, 36, 5, fill);
      text(this.context, label, x + 11, y + 7, 21, ink);
      return x + width + 10;
    }

    timeCell(label, value, x, y, width, actual = false) {
      rounded(this.context, x, y, width, 92, 9, actual ? '#EAF0E3' : '#F7EEDD', actual ? '#CED9C3' : '#E2D2BE');
      text(this.context, label, x + 17, y + 12, 21, actual ? '#718569' : '#907660');
      fittedText(this.context, value, x + 17, y + 46, 28, width - 34, actual ? '#52734E' : '#75513E', true, 15);
    }
  }

  class TaskImageCard extends ImageCard {
    draw() {
      const context = this.context;
      const block = this.block;
      const task = block.task;
      const completed = task.overallCompleted;
      this.frame(completed ? '#F2F5E9' : '#FFF9EE', completed ? '#C5D0B7' : '#DCCBBB');
      rounded(context, this.x, block.top + 18, 4, block.height - 36, 2, completed ? '#77936C' : '#AC3447');
      let chipX = this.x + 28;
      const chipY = block.top + 19;
      chipX = this.badge(task.mode === 'multi-day' ? '多日任务' : '单日任务', chipX, chipY, '#F1E3D0', '#876447');
      if (completed) chipX = this.badge('已完成', chipX, chipY, '#E1EAD6', '#5A7650');
      if (task.done) chipX = this.badge(task.exportContext === 'history' ? '当日已打卡' : '今日已打卡', chipX, chipY, '#E2EEE3', '#56755E');
      else if (!completed) chipX = this.badge(task.mode === 'multi-day' ? '进行中' : '待学习', chipX, chipY, '#F2EADF', '#917D6D');
      if (task.mode === 'multi-day' && task.exportContext !== 'history') {
        fittedText(context, `累计打卡 ${task.checkinDays} 天`, this.x + 760, chipY + 7, 21, 250, COLORS.muted);
      }
      if (block.continued) text(context, '续', this.x + this.width - 30, chipY + 5, 17, COLORS.muted, false, 'right');
      let y = block.top + PAD + CARD_HEADER;
      for (const item of block.lines) {
        if (item.role === 'estimate') {
          line(context, this.x + 28, y + 4, this.x + this.width - 28, y + 4, '#E7D9C7');
          const width = (this.width - 72) / 2;
          const estimate = task.estimate.minutes === null ? '待补充' : timeTools().formatMinutes(task.estimate.minutes);
          const actual = task.actual.recorded ? timeTools().formatMinutes(task.actual.minutes) : task.done ? '未记录' : '待打卡';
          this.timeCell('预计用时', estimate, this.x + 28, y + 15, width);
          this.timeCell('实际用时', actual, this.x + 44 + width, y + 15, width, true);
        } else if (item.text) text(context, item.text, this.x + 28, y, item.size, item.color, item.bold);
        y += item.height;
      }
    }
  }

  class SubjectImageCard extends ImageCard {
    draw() {
      const y = this.block.top + 20;
      rounded(this.context, this.x, y + 1, 4, 28, 2, COLORS.red);
      text(this.context, this.block.name + (this.block.continued ? ' · 续' : ''), this.x + 19, y, 30, COLORS.ink, true);
    }
  }

  function drawPage(context, document, page, day, number, crest) {
    drawHeader(context, day, document, number, crest);
    for (const block of page.blocks) {
      if (block.type === 'subject') new SubjectImageCard(context, block).draw();
      else if (block.type === 'rest') {
        new ImageCard(context, block).frame(COLORS.row, COLORS.rule);
        text(context, '今天没有安排学习任务', 110, block.top + 43, 29, COLORS.ink, true);
        text(context, '休息与调整，也是学习计划的一部分。', 111, block.top + 103, 23, COLORS.muted);
      } else new TaskImageCard(context, block).draw();
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
      image.src = new URL('./assets/sjtu-emblem-round.svg', root.document.baseURI).href;
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
    let exportAssignments = assignments;
    if (root.StudyStore?.request) {
      try { exportAssignments = hydrateEstimates(assignments, await root.StudyStore.request('/api/library')); }
      catch { /* Saved estimates still export when the optional library fallback is unavailable. */ }
    }
    await prepareTypography();
    const crest = await getCrest();
    const canvas = root.document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建图片画布，请换用新版浏览器后重试。');
    prepareContext(context);
    const document = layoutDocument(exportAssignments, (value, size, bold) => { font(context, size, bold); return context.measureText(value).width; });
    const files = [];
    try {
      await yieldToBrowser();
      for (let i = 0; i < document.pages.length; i += 1) {
        const page = document.pages[i];
        canvas.width = WIDTH * SCALE; canvas.height = page.height * SCALE;
        prepareContext(context, SCALE);
        drawPage(context, document, page, day, i + 1, crest);
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('浏览器未能生成 PNG 图片，请减少单日任务后重试。')), 'image/png'));
        const suffix = document.pages.length > 1 ? `_p${i + 1}` : '';
        files.push({ name: `今日打卡_${date}${suffix}.png`, blob, width: WIDTH * SCALE, height: page.height * SCALE });
        canvas.width = canvas.height = 1;
        if (i + 1 < document.pages.length) await yieldToBrowser();
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

  return { exportDaily, chooseDirectory, getDirectoryInfo, clearDirectory, _test: { normalize, wrap, layoutDocument, hydrateEstimates, dateValue, crc32, zipFiles, WIDTH, MAX_HEIGHT } };
});
