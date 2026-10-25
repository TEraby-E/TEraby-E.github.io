/* Browser-local persistence for the buildless GitHub Pages edition. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyStore = api;
})(typeof globalThis === 'object' ? globalThis : this, function (root) {
  'use strict';

  const SUBJECTS = Object.freeze({ english: '英语', calculus: '高数', linear: '线代', probability: '概率论', ds: '数据结构', co: '计组', os: '操作系统', cn: '计网' });
  const SUBJECT_ORDER = Object.keys(SUBJECTS);
  const BACKUP_FORMAT = 'sjtu-study-checkin-backup';
  const MAX_TASKS = 100;
  const MAX_ARCHIVES = 36525;
  const copy = (value) => JSON.parse(JSON.stringify(value));

  class StoreError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.name = 'StoreError';
      this.status = status;
    }
  }

  function validateDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new StoreError('日期必须使用 YYYY-MM-DD 格式。');
    const date = new Date(value + 'T12:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new StoreError('日期不是有效的日历日期。');
    return value;
  }

  function nextDate(value) {
    validateDate(value);
    const date = new Date(value + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + 1);
    const next = date.toISOString().slice(0, 10);
    return validateDate(next);
  }

  function localDate(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function namespace(href) {
    return `sjtu-study-checkin:${new URL('./', href).pathname}`;
  }

  function libraryIndex(library) {
    if (!library || !Array.isArray(library.subjects)) throw new StoreError('章节任务库的格式不正确。');
    const index = new Map();
    for (const subject of library.subjects) {
      if (!SUBJECTS[subject.id] || subject.name !== SUBJECTS[subject.id] || !Array.isArray(subject.chapters)) throw new StoreError('章节任务库的科目不正确。');
      for (const chapter of subject.chapters) {
        if (typeof chapter.id !== 'string' || !Array.isArray(chapter.tasks)) throw new StoreError('章节任务库的章节不正确。');
        for (const task of chapter.tasks) {
          if (typeof task.id !== 'string' || index.has(task.id)) throw new StoreError('章节任务库含有重复或无效任务。');
          index.set(task.id, { subject, chapter, task });
        }
      }
    }
    if (new Set(library.subjects.map((subject) => subject.id)).size !== SUBJECT_ORDER.length) throw new StoreError('章节任务库缺少科目。');
    return index;
  }

  function normaliseAssignments(assignments, index) {
    if (!Array.isArray(assignments) || assignments.length > MAX_TASKS) throw new StoreError('每天最多选择 100 项任务。');
    const seen = new Set();
    const result = assignments.map((item) => {
      if (!item || typeof item !== 'object' || typeof item.task_id !== 'string' || item.task_id.length > 200) throw new StoreError('任务格式不正确。');
      if (seen.has(item.task_id)) throw new StoreError('同一天不能重复添加同一项任务。');
      seen.add(item.task_id);
      if ('done' in item && typeof item.done !== 'boolean') throw new StoreError('打卡状态不正确。');
      let row;
      const canonical = index.get(item.task_id);
      if (canonical) {
        const { subject, chapter, task } = canonical;
        row = Object.fromEntries(['title', 'detail', 'kind', 'reference', 'quantity', 'remarks'].map((key) => [key, String(task[key] ?? '')]));
        Object.assign(row, { task_id: task.id, subject_id: subject.id, subject_name: subject.name, chapter_id: chapter.id, chapter_title: chapter.title });
      } else if (item.task_id.startsWith('custom-') && SUBJECTS[item.subject_id]) {
        if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 400 || (item.detail !== undefined && typeof item.detail !== 'string') || (item.detail || '').length > 10000) throw new StoreError('请填写有效的任务名称。');
        row = { task_id: item.task_id, subject_id: item.subject_id, subject_name: SUBJECTS[item.subject_id], chapter_id: 'custom', chapter_title: '自定义任务', title: item.title.trim(), detail: (item.detail || '').trim(), kind: '自定义', reference: '', quantity: '', remarks: '' };
      } else throw new StoreError('任务库中未找到这项任务，请重新选择。');
      row.done = item.done ?? false;
      return row;
    });
    return result.sort((a, b) => SUBJECT_ORDER.indexOf(a.subject_id) - SUBJECT_ORDER.indexOf(b.subject_id));
  }

  function initialRecord(date = localDate()) {
    return { revision: 1, current: { date: validateDate(date), assignments: [] }, archives: [] };
  }

  function stateOf(record) {
    const completed = new Set();
    for (const day of [record.current, ...record.archives]) for (const task of day.assignments) if (task.done) completed.add(task.task_id);
    return copy({ date: record.current.date, revision: record.revision, assignments: record.current.assignments, history: record.archives.map((day) => ({ date: day.date, total: day.assignments.length, completed: day.assignments.filter((task) => task.done).length })).sort((a, b) => b.date.localeCompare(a.date)), completed_ids: [...completed].sort() });
  }

  function checkRevision(record, payload) {
    if (!payload || !Number.isSafeInteger(payload.revision) || payload.revision < 1 || payload.revision !== record.revision || payload.date !== record.current.date) throw new StoreError('内容已在另一个页面更新，请刷新后再试。', 409);
    if (record.revision >= Number.MAX_SAFE_INTEGER) throw new StoreError('记录版本已达上限，请导出备份。');
  }

  function saveRecord(record, payload, index) {
    checkRevision(record, payload);
    const assignments = normaliseAssignments(payload.assignments, index);
    return { ...copy(record), revision: record.revision + 1, current: { date: record.current.date, assignments } };
  }

  function archiveRecord(record, payload) {
    checkRevision(record, payload);
    if ('carry_pending' in payload && typeof payload.carry_pending !== 'boolean') throw new StoreError('未完成任务的保留选项不正确。');
    const next = nextDate(record.current.date);
    const existingTomorrow = record.archives.find((day) => day.date === next);
    const archives = record.archives.filter((day) => day.date !== record.current.date && day.date !== next);
    archives.push(copy(record.current));
    const carried = payload.carry_pending === false ? [] : record.current.assignments.filter((task) => !task.done);
    return { revision: record.revision + 1, current: { date: next, assignments: mergeTasks(existingTomorrow?.assignments || [], carried) }, archives };
  }

  function validateBackup(value, index) {
    if (!value || value.format !== BACKUP_FORMAT || value.version !== 1 || !value.current || !Array.isArray(value.archives) || value.archives.length > MAX_ARCHIVES) throw new StoreError('请选择交大学习手账导出的完整 JSON 备份。');
    const day = (entry) => {
      if (!entry || typeof entry !== 'object') throw new StoreError('备份中的日期记录不正确。');
      return { date: validateDate(entry.date), assignments: normaliseAssignments(entry.assignments, index) };
    };
    const current = day(value.current);
    const dates = new Set();
    const archives = value.archives.map((entry) => {
      const result = day(entry);
      if (dates.has(result.date) || result.date === current.date) throw new StoreError('备份含有重复日期，请检查后再导入。');
      dates.add(result.date);
      return result;
    });
    return { current, archives };
  }

  function mergeTasks(existing, incoming) {
    const result = existing.map((item) => ({ ...item }));
    const map = new Map(result.map((item) => [item.task_id, item]));
    for (const task of incoming) {
      const previous = map.get(task.task_id);
      if (previous) previous.done = previous.done || task.done;
      else { const added = { ...task }; map.set(task.task_id, added); result.push(added); }
    }
    if (result.length > MAX_TASKS) throw new StoreError('合并后某一天超过 100 项任务，未导入任何内容。请先整理备份。');
    return result.sort((a, b) => SUBJECT_ORDER.indexOf(a.subject_id) - SUBJECT_ORDER.indexOf(b.subject_id));
  }

  function importRecord(record, incoming, options = {}) {
    if (!Number.isSafeInteger(options.revision) || options.revision !== record.revision || record.revision >= Number.MAX_SAFE_INTEGER) throw new StoreError('内容已在另一个页面更新，请刷新后再导入。', 409);
    if ('replace' in options && typeof options.replace !== 'boolean') throw new StoreError('备份导入选项不正确。');
    if (options.replace || (!record.current.assignments.length && !record.archives.length)) return { revision: record.revision + 1, ...copy(incoming) };
    const merged = new Map(record.archives.map((day) => [day.date, copy(day)]));
    const current = copy(record.current);
    for (const day of [...incoming.archives, incoming.current]) {
      if (day.date === current.date) current.assignments = mergeTasks(current.assignments, day.assignments);
      else {
        const previous = merged.get(day.date);
        merged.set(day.date, { date: day.date, assignments: previous ? mergeTasks(previous.assignments, day.assignments) : copy(day.assignments) });
      }
    }
    return { revision: record.revision + 1, current, archives: [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  }

  function storageError(error) {
    if (error instanceof StoreError) return error;
    if (error?.name === 'QuotaExceededError') return new StoreError('浏览器存储空间不足，学习记录尚未保存。请先导出备份，再释放空间。', 507);
    if (error?.name === 'SecurityError' || error?.name === 'NotAllowedError') return new StoreError('浏览器禁止保存本站数据，请允许此网站使用本地存储后重试。', 503);
    return new StoreError('浏览器中的学习记录暂时无法读写，请导出备份或重新载入后重试。', 503);
  }

  function createStore(env = root) {
    const href = env.location?.href || 'https://example.invalid/';
    const dbName = namespace(href);
    let libraryPromise;
    let dbPromise;
    let channel;
    const subscribers = new Set();

    function loadLibrary() {
      if (!libraryPromise) libraryPromise = (async () => {
        try {
          const response = await env.fetch(new URL('data/library.json', href).href, { cache: 'no-cache' });
          if (!response.ok) throw new Error('library unavailable');
          const value = await response.json();
          return { library: value, index: libraryIndex(value) };
        } catch (error) {
          libraryPromise = null;
          if (error instanceof StoreError) throw error;
          throw new StoreError('章节任务库暂时无法载入，请检查网络后重试。', 503);
        }
      })();
      return libraryPromise;
    }

    function openDb() {
      if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
        if (!env.indexedDB) { reject(new StoreError('当前浏览器不支持本地学习记录，请用新版 Chrome、Edge 或 Firefox 打开。', 503)); return; }
        let request;
        let settled = false;
        try { request = env.indexedDB.open(dbName, 1); } catch (error) { reject(storageError(error)); return; }
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('records')) request.result.createObjectStore('records'); };
        request.onblocked = () => { settled = true; reject(new StoreError('另一个页面正在占用学习记录，请关闭其他打卡页面后重试。', 503)); };
        request.onerror = () => { settled = true; reject(storageError(request.error)); };
        request.onsuccess = () => {
          const db = request.result;
          if (settled) { db.close(); return; }
          db.onversionchange = () => { db.close(); dbPromise = null; };
          if (env.document && env.BroadcastChannel && !channel) {
            channel = new env.BroadcastChannel(dbName);
            channel.onmessage = (event) => {
              if (event.data?.type !== 'changed') return;
              subscribers.forEach((callback) => callback(event.data.revision));
              if (env.dispatchEvent && env.CustomEvent) env.dispatchEvent(new env.CustomEvent('study-store-changed', { detail: { revision: event.data.revision } }));
            };
          }
          resolve(db);
        };
      }).catch((error) => { dbPromise = null; throw error; });
      return dbPromise;
    }

    async function transact(operation) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        let transaction;
        let result;
        let changedRevision;
        let operationError;
        try {
          transaction = db.transaction('records', 'readwrite');
          const store = transaction.objectStore('records');
          const request = store.get('main');
          request.onsuccess = () => {
            try {
              const previous = request.result || initialRecord(localDate(env.now ? env.now() : new Date()));
              const outcome = operation(previous);
              result = outcome.result;
              if (outcome.record || !request.result) store.put(outcome.record || previous, 'main');
              if (outcome.record) changedRevision = outcome.record.revision;
            } catch (error) { operationError = error; transaction.abort(); }
          };
          transaction.oncomplete = () => {
            if (changedRevision) channel?.postMessage({ type: 'changed', revision: changedRevision });
            resolve(result);
          };
          transaction.onerror = () => { /* The abort event is the single rejection path. */ };
          transaction.onabort = () => reject(storageError(operationError || transaction.error));
        } catch (error) { reject(storageError(error)); }
      });
    }

    async function request(path, options = {}) {
      const method = (options.method || 'GET').toUpperCase();
      if (path === '/api/library' && method === 'GET') return copy((await loadLibrary()).library);
      let payload;
      if (options.body !== undefined) {
        try { payload = JSON.parse(options.body); } catch { throw new StoreError('保存的内容格式不正确。'); }
      }
      if (path === '/api/state' && method === 'GET') return transact((record) => ({ result: stateOf(record) }));
      if (path === '/api/state' && method === 'PUT') {
        const { index } = await loadLibrary();
        return transact((record) => { const next = saveRecord(record, payload, index); return { record: next, result: stateOf(next) }; });
      }
      if (path === '/api/archive' && method === 'POST') return transact((record) => { const next = archiveRecord(record, payload); return { record: next, result: { ...stateOf(next), saved_date: record.current.date } }; });
      if (path.startsWith('/api/history/') && method === 'GET') {
        let date;
        try { date = decodeURIComponent(path.slice('/api/history/'.length)); } catch { throw new StoreError('历史日期不正确。'); }
        validateDate(date);
        return transact((record) => { const day = record.archives.find((item) => item.date === date); if (!day) throw new StoreError('没有找到这一天的打卡记录。', 404); return { result: copy(day) }; });
      }
      throw new StoreError('操作不存在。', 404);
    }

    async function exportBackup() {
      return transact((record) => ({ result: { format: BACKUP_FORMAT, version: 1, exported_at: new Date().toISOString(), current: copy(record.current), archives: copy(record.archives) } }));
    }

    async function importBackup(value, options = {}) {
      const { index } = await loadLibrary();
      const incoming = validateBackup(value, index);
      return transact((record) => { const next = importRecord(record, incoming, options); return { record: next, result: stateOf(next) }; });
    }

    return { request, exportBackup, importBackup, subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); }, async close() { const db = dbPromise ? await dbPromise : null; db?.close(); dbPromise = null; channel?.close(); channel = null; }, databaseName: dbName };
  }

  const api = createStore();
  api.createStore = createStore;
  api.StoreError = StoreError;
  api.helpers = Object.freeze({ validateDate, nextDate, localDate, namespace, libraryIndex, normaliseAssignments, initialRecord, stateOf, saveRecord, archiveRecord, validateBackup, mergeTasks, importRecord, storageError });
  return api;
});
