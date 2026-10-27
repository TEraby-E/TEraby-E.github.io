'use strict';

(() => {
  const SUBJECT_NAMES = ['英语', '高数', '线代', '概率论', '数据结构', '计组', '操作系统', '计网'];
  const SUBJECT_LABELS = Object.freeze({ ds: 'DS', co: 'CO', os: 'OS', cn: 'CN' });
  const subjectName = (subject) => SUBJECT_LABELS[subject.id || subject.subject_id] || subject.name || subject.subject_name || '';
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const icon = (name, extraClass = '') => `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const cloneAssignments = () => state.assignments.map((assignment) => ({ ...assignment }));
  let library = [];
  let retiredTasks = new Map();
  let catalogIndex = null;
  let stateIndex = null;
  const preparedCatalogues = new WeakMap();
  let state = null;
  let dirty = false;
  let changeVersion = 0;
  let saveTimer = null;
  let searchTimer = null;
  let savePromise = null;
  let actionBusy = false;
  let errorRetry = null;
  let toastTimer = null;
  let toastAction = null;
  let subjectDraft = null;
  let historyDate = null;
  let historyRecord = null;
  let historyRequest = 0;
  let loadRequest = 0;
  let installPrompt = null;
  let estimateDraft = null;
  let completionDraft = null;
  const dialogOpeners = new Map();

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

  async function api(path, options = {}) {
    if (!window.StudyStore) throw new ApiError('记录模块没有载入，请刷新页面后重试。', 0);
    return window.StudyStore.request(path, options);
  }

  function normaliseState(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Array.isArray(value.assignments)) {
      throw new Error('学习记录的格式不正确，请重新载入。');
    }
    return { ...value, history: Array.isArray(value.history) ? value.history : [], completed_ids: Array.isArray(value.completed_ids) ? value.completed_ids : [], library_completed_ids: Array.isArray(value.library_completed_ids) ? value.library_completed_ids : [], library_reopened_ids: Array.isArray(value.library_reopened_ids) ? value.library_reopened_ids : [], task_modes: value.task_modes || {}, subject_phases: value.subject_phases || {}, task_progress: value.task_progress || {}, assignments: value.assignments.map((assignment) => ({ ...assignment, done: Boolean(assignment.done) })) };
  }

  function dateParts(date) {
    const [year, month, day] = date.split('-').map(Number);
    return { year, month, day, value: new Date(year, month - 1, day) };
  }

  function readableDate(date) {
    const { year, month, day } = dateParts(date);
    return `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
  }

  class CatalogueIndex {
    constructor(subjects, retired) {
      this.source = subjects;
      this.retired = retired;
      this.tasks = new Map();
      this.chapters = new Map();
      this.identities = new Map();
      this.groups = new Map();
      this.searchText = new WeakMap();
      for (const subject of subjects) for (const chapter of subject.chapters) {
        this.chapters.set(chapter.id, chapter);
        for (const task of chapter.tasks) {
          this.tasks.set(task.id, { task, subject, chapter });
          const identity = task.estimate_group || task.id;
          this.identities.set(task.id, identity);
          if (!this.groups.has(identity)) this.groups.set(identity, []);
          this.groups.get(identity).push(task.id);
        }
      }
    }

    text(item, fields) {
      if (!this.searchText.has(item)) this.searchText.set(item, fields.map((field) => String(item[field] || '').toLocaleLowerCase()).join('\n'));
      return this.searchText.get(item);
    }
  }

  function catalogue() {
    if (!catalogIndex || catalogIndex.source !== library || catalogIndex.retired !== retiredTasks) catalogIndex = new CatalogueIndex(library, retiredTasks);
    return catalogIndex;
  }

  class StateIndex {
    constructor(source) {
      this.source = source;
      this.version = changeVersion;
      this.assignments = source.assignments;
      this.completedSource = source.completed_ids;
      this.markedSource = source.library_completed_ids;
      this.reopenedSource = source.library_reopened_ids;
      this.byId = new Map();
      this.bySubject = new Map();
      for (const task of source.assignments) {
        this.byId.set(task.task_id, task);
        if (!this.bySubject.has(task.subject_id)) this.bySubject.set(task.subject_id, []);
        this.bySubject.get(task.subject_id).push(task);
      }
      this.completed = new Set(source.completed_ids);
      this.marked = new Set(source.library_completed_ids);
      this.reopened = new Set(source.library_reopened_ids);
    }

    matches(source) {
      return this.source === source && this.version === changeVersion && this.assignments === source.assignments && this.completedSource === source.completed_ids && this.markedSource === source.library_completed_ids && this.reopenedSource === source.library_reopened_ids;
    }
  }

  function currentIndex() {
    if (!stateIndex || !stateIndex.matches(state)) stateIndex = new StateIndex(state);
    return stateIndex;
  }

  function subjectAssignments(id, assignments = state?.assignments || []) {
    return state && assignments === state.assignments ? currentIndex().bySubject.get(id) || [] : assignments.filter((assignment) => assignment.subject_id === id);
  }

  function chapterLine(assignment, className) {
    const chapterTitle = String(assignment.chapter_title || catalogue().chapters.get(assignment.chapter_id)?.title || '').trim();
    if (!chapterTitle || String(assignment.title || '').includes(chapterTitle)) return '';
    return `<span class="${className}">${escape(chapterTitle)}</span>`;
  }

  function canonicalTask(task) {
    const id = task.task_id || task.id;
    const entry = catalogue().tasks.get(id);
    if (entry && (!task.subject_id || task.subject_id === entry.subject.id)) return entry.task;
    return retiredTasks.get(id) || null;
  }

  function taskEstimate(task) {
    return window.StudyTime?.getEstimate(task, canonicalTask(task)) || { minutes: null, source: '', group: null };
  }

  function timeSummary(tasks) {
    return window.StudyTime?.summarize(tasks, library) || { minutes: 0, unknown: tasks.length, known: 0 };
  }

  function formattedTime(minutes) {
    return window.StudyTime?.formatMinutes(minutes) || `${minutes}分钟`;
  }

  function estimateText(task) {
    const estimate = taskEstimate(task);
    return estimate.label || (estimate.minutes === null ? '预计用时待补充' : `预计 ${formattedTime(estimate.minutes)}`);
  }

  function taskActual(task) {
    if (window.StudyTime?.getActual) return window.StudyTime.getActual(task);
    const recorded = task.done && typeof task.actual_minutes === 'number' && Number.isFinite(task.actual_minutes) && task.actual_minutes >= 0;
    return { minutes: recorded ? task.actual_minutes : null, recorded, label: !task.done ? '实际待完成' : recorded ? `实际${formattedTime(task.actual_minutes)}` : '实际未记录' };
  }

  function summaryText(tasks) {
    const summary = timeSummary(tasks);
    if (!summary.known && summary.unknown) return `预计用时待补充 · ${summary.unknown}项未设置`;
    return `预计 ${formattedTime(summary.minutes)}${summary.unknown ? ` · 另${summary.unknown}项待补充` : ''}`;
  }

  function actualSummaryText(tasks) {
    const summary = timeSummary(tasks);
    if (!summary.actualKnown && summary.actualUnknown) return `实际用时待补记 · ${summary.actualUnknown}项未记录`;
    return `实际 ${formattedTime(summary.actualMinutes || 0)}${summary.actualUnknown ? ` · 另${summary.actualUnknown}项未记录` : ''}`;
  }

  function completionKey(task) {
    return taskEstimate(task).group || task.task_id;
  }

  function expandedCompletionTasks(tasks, mode = 'complete') {
    const keys = new Set(tasks.map(completionKey));
    return state.assignments.filter((task) => keys.has(completionKey(task)) && (mode !== 'edit' || task.done));
  }

  function openCompletion(taskIds, mode = 'complete') {
    if (!state || actionBusy) return;
    const requested = state.assignments.filter((task) => taskIds.includes(task.task_id) && (mode === 'edit' ? task.done : !task.done));
    if (!requested.length) return;
    const tasks = expandedCompletionTasks(requested, mode);
    const groups = new Map();
    tasks.forEach((task) => {
      const key = completionKey(task);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    });
    const entries = [...groups.values()].map((rows) => ({ taskIds: rows.map((task) => task.task_id), rows }));
    completionDraft = { date: state.date, version: changeVersion, mode, entries };
    $('completion-title').textContent = mode === 'edit' ? '记录实际用时' : '完成任务，记下实际用时';
    $('completion-description').textContent = mode === 'edit' ? '可修改已记录的实际用时；尚未记录时默认填入预计时间。' : entries.length > 1 ? `这 ${entries.length} 项任务的实际用时默认按预计时间填写，可修改后保存打卡。` : '实际用时默认按预计时间填写，可修改后保存打卡。';
    $('completion-fields').innerHTML = entries.map(({ rows }, index) => {
      const task = rows[0];
      const recorded = rows.map(taskActual).filter((actual) => actual.recorded).map((actual) => actual.minutes);
      const estimates = rows.map(taskEstimate).filter((estimate) => estimate.minutes !== null).map((estimate) => estimate.minutes);
      const initial = recorded.length ? String(Math.max(...recorded)) : estimates.length ? String(Math.max(...estimates)) : '';
      const subjects = [...new Set(rows.map((item) => subjectName(item) || subjectName(library.find((subject) => subject.id === item.subject_id) || {})))].filter(Boolean);
      return `<section class="completion-entry"><div class="completion-entry-copy"><h3>${escape(task.title)}</h3><p>${escape(subjects.join(' · '))}${rows.length > 1 ? ` · ${rows.length} 个共享条目，只计一次` : ''}</p><span class="completion-estimate">${escape(estimateText(task))}</span></div><label class="completion-input-label" for="actual-minutes-${index}">实际用时<span class="completion-input-row"><input id="actual-minutes-${index}" data-completion-index="${index}" type="number" min="0" max="525600" step="any" inputmode="decimal" required placeholder="填写实际分钟" value="${initial}" aria-describedby="completion-help completion-error"><span>分钟</span></span></label></section>`;
    }).join('');
    $('completion-error').hidden = true;
    $('save-completion').textContent = mode === 'edit' ? '保存实际用时' : '保存并打卡';
    openDialog('completion-dialog');
    [...$('completion-fields').querySelectorAll('input[data-completion-index]')].forEach((input, index) => {
      const rows = entries[index].rows;
      const recorded = rows.map(taskActual).filter((actual) => actual.recorded).map((actual) => actual.minutes);
      const estimates = rows.map(taskEstimate).filter((estimate) => typeof estimate.minutes === 'number' && Number.isFinite(estimate.minutes)).map((estimate) => estimate.minutes);
      const initial = recorded.length ? String(Math.max(...recorded)) : estimates.length ? String(Math.max(...estimates)) : '';
      input.defaultValue = initial;
      input.value = initial;
    });
    const firstInput = $('completion-fields').querySelector('input');
    firstInput?.focus({ preventScroll: true });
    firstInput?.select();
  }

  async function saveCompletion() {
    if (!completionDraft || !state || actionBusy) return;
    const draft = completionDraft;
    if (draft.date !== state.date || draft.version !== changeVersion || draft.entries.some((entry) => entry.taskIds.some((id) => !state.assignments.some((task) => task.task_id === id)))) {
      closeDialog('completion-dialog');
      showToast('今日清单已更新，请重新选择任务记录实际用时。');
      return;
    }
    const inputs = [...$('completion-fields').querySelectorAll('input[data-completion-index]')];
    const values = inputs.map((input) => ({ input, raw: input.value.trim(), minutes: Number(input.value) }));
    const invalid = values.find(({ input, raw, minutes }) => raw === '' || input.validity?.badInput || !Number.isFinite(minutes) || minutes < 0 || minutes > 525600);
    if (invalid || values.length !== draft.entries.length) {
      $('completion-error').textContent = '请为每项任务填写 0 至 525600 的实际分钟数，支持小数；没有耗时可填 0。';
      $('completion-error').hidden = false;
      invalid?.input.focus();
      return;
    }
    draft.entries.forEach((entry, index) => entry.taskIds.forEach((id) => {
      const task = state.assignments.find((item) => item.task_id === id);
      if (draft.mode === 'complete') new LearningTask(task).recordCheckin(values[index].minutes);
      else task.actual_minutes = values[index].minutes;
    }));
    const count = draft.entries.reduce((sum, entry) => sum + entry.taskIds.length, 0);
    const focusId = draft.entries[0].taskIds[0];
    closeDialog('completion-dialog');
    changed();
    [...document.querySelectorAll('#daily-tbody input[data-task]')].find((input) => input.dataset.task === focusId)?.focus({ preventScroll: true });
    try {
      await flushAutosave();
      renderDay();
      showToast(draft.mode === 'edit' ? '实际用时已保存。' : `${count} 项任务已打卡，实际用时已保存。`, null, 4500);
    } catch {
      showToast('本次打卡尚未保存，请查看页面提示后重试。', null, 6500);
    }
  }

  function undoCompletion(tasks) {
    tasks.forEach((task) => new LearningTask(task).undoCheckin());
    changed();
  }

  function openEstimate(taskId) {
    if (!state || actionBusy) return;
    const task = state.assignments.find((item) => item.task_id === taskId);
    if (!task) return;
    const estimate = taskEstimate(task);
    const originalTask = canonicalTask(task);
    const original = originalTask ? taskEstimate(originalTask) : { minutes: null, source: '', label: '原资料未提供用时' };
    const related = estimate.group ? state.assignments.filter((item) => taskEstimate(item).group === estimate.group) : [task];
    estimateDraft = { date: state.date, taskId };
    $('estimate-task-title').textContent = task.title;
    $('estimate-original').textContent = `${originalTask ? '原任务：' : ''}${original.label || '原资料未提供用时'}${original.source ? ` · ${original.source}` : ''}`;
    $('estimate-minutes').value = estimate.minutes === null ? '' : String(estimate.minutes);
    $('estimate-error').hidden = true;
    $('estimate-group-note').hidden = related.length < 2;
    $('estimate-group-note').textContent = related.length > 1 ? `这 ${related.length} 个条目属于同一原任务，会一并调整，今日总时长只计一次。` : '';
    openDialog('estimate-dialog');
    $('estimate-minutes').focus({ preventScroll: true });
    $('estimate-minutes').select();
  }

  function editEstimate(restore = false) {
    if (!estimateDraft || !state || actionBusy) return;
    const task = state.assignments.find((item) => item.task_id === estimateDraft.taskId);
    if (!task || state.date !== estimateDraft.date) {
      closeDialog('estimate-dialog');
      showToast('今日清单已更新，请重新选择任务安排用时。');
      return;
    }
    const raw = $('estimate-minutes').value.trim();
    const minutes = raw === '' ? null : Number(raw);
    if (!restore && ($('estimate-minutes').validity?.badInput || (minutes !== null && (!Number.isFinite(minutes) || minutes < 0 || minutes > 525600 || Math.abs(minutes * 2 - Math.round(minutes * 2)) > 1e-8)))) {
      $('estimate-error').textContent = '请填写 0 至 525600 分钟，可按 0.5 分钟递增；留空表示待补充。';
      $('estimate-error').hidden = false;
      $('estimate-minutes').focus();
      return;
    }
    const group = taskEstimate(task).group;
    const related = group ? state.assignments.filter((item) => taskEstimate(item).group === group) : [task];
    related.forEach((item) => {
      if (restore) {
        delete item.estimated_minutes;
        delete item.estimated_source;
        delete item.estimate_group;
        const original = canonicalTask(item);
        if (original) {
          item.estimated_minutes = original.estimated_minutes ?? null;
          item.estimated_source = original.estimated_source || '';
          item.estimate_group = original.estimate_group || null;
        }
      } else {
        item.estimated_minutes = minutes;
        item.estimated_source = '今日手动安排';
        item.estimate_group = group || null;
      }
    });
    const taskId = task.task_id;
    closeDialog('estimate-dialog');
    changed();
    [...document.querySelectorAll('[data-action="edit-time"]')].find((button) => button.dataset.task === taskId)?.focus({ preventScroll: true });
    showToast(restore ? '已恢复原任务的预计用时。' : related.length > 1 ? `已更新 ${related.length} 个共享条目，今日总时长只计一次。` : minutes === null ? '今日用时已标为待补充。' : '今天计划投入的用时已更新。', null, 4500);
  }

  function setStatus(status, message) {
    $('save-status').dataset.status = status;
    $('save-status-text').textContent = message;
  }

  function showError(message, retry = null) {
    $('error-text').textContent = message;
    $('error-banner').hidden = false;
    $('retry-button').hidden = !retry;
    errorRetry = retry;
  }

  function clearError() {
    $('error-banner').hidden = true;
    errorRetry = null;
  }

  function showToast(message, action = null, timeout = 5000) {
    window.clearTimeout(toastTimer);
    const openModal = document.querySelector('dialog[open]');
    (openModal || document.body).append($('toast'));
    $('toast').classList.toggle('toast-in-dialog', Boolean(openModal));
    $('toast-message').textContent = message;
    $('toast-action').hidden = !action;
    toastAction = action;
    $('toast').hidden = false;
    if (timeout) toastTimer = window.setTimeout(() => { $('toast').hidden = true; }, timeout);
  }

  function updateControls() {
    const unavailable = !state || actionBusy;
    $('history-button').disabled = unavailable;
    $('data-button').disabled = unavailable;
    $('export-button').disabled = unavailable;
    $('archive-button').disabled = unavailable;
    $('confirm-archive').disabled = unavailable;
    $('export-history-button').disabled = actionBusy || !historyRecord;
    $('save-estimate').disabled = unavailable;
    $('reset-estimate').disabled = unavailable;
    $('estimate-minutes').disabled = unavailable;
    $('save-completion').disabled = unavailable;
    document.querySelectorAll('#completion-fields input').forEach((input) => { input.disabled = unavailable; });
    document.querySelectorAll('#daily-tbody button, #daily-tbody input').forEach((element) => { element.disabled = unavailable; });
    $('task-sheet').setAttribute('aria-busy', String(unavailable));
  }

  // Composite parent: tasks and chapters share partitioning and folded rendering.
  class LearningNode {
    constructor(data, children = []) {
      this.data = data;
      this.id = data.task_id || data.id;
      this.children = children;
    }

    static relatedIds(taskId) {
      const index = catalogue();
      const identity = index.identities.get(taskId);
      return identity ? index.groups.get(identity) : [taskId];
    }

    get taskIds() {
      return this.children.length ? [...new Set(this.children.flatMap((child) => child.taskIds))] : LearningNode.relatedIds(this.id);
    }

    get mode() {
      return state.task_modes[this.id] || this.data.task_mode || currentIndex().byId.get(this.id)?.task_mode || canonicalTask(this.data)?.task_mode || 'single-day';
    }

    get completed() {
      if (this.children.length) return this.children.every((child) => child.completed);
      const ids = this.taskIds;
      const index = currentIndex();
      if (ids.some((id) => index.reopened.has(id))) return false;
      if (ids.some((id) => index.marked.has(id))) return true;
      if (this.mode === 'multi-day') return false;
      return ids.some((id) => { const task = index.byId.get(id); return index.completed.has(id) || Boolean(task?.done && taskMode(task) !== 'multi-day'); });
    }

    setCompleted(completed) {
      const marked = new Set(state.library_completed_ids);
      const reopened = new Set(state.library_reopened_ids);
      this.taskIds.forEach((id) => {
        if (completed) { marked.add(id); reopened.delete(id); }
        else { marked.delete(id); reopened.add(id); }
      });
      state.library_completed_ids = [...marked];
      state.library_reopened_ids = [...reopened];
      return completed;
    }

    toggleCompleted() {
      return this.setCompleted(!this.completed);
    }

    setMode(mode) {
      if (!['single-day', 'multi-day'].includes(mode)) return;
      const ids = new Set(this.taskIds);
      ids.forEach((id) => { state.task_modes[id] = mode; });
      state.assignments.filter((task) => ids.has(task.task_id)).forEach((task) => { task.task_mode = mode; });
    }

    recordCheckin(minutes) {
      const index = currentIndex();
      this.taskIds.forEach((id) => { const task = index.byId.get(id); if (task) { task.done = true; task.actual_minutes = minutes; } });
    }

    undoCheckin() {
      const index = currentIndex();
      this.taskIds.forEach((id) => { const task = index.byId.get(id); if (task) { task.done = false; task.actual_minutes = null; } });
    }

    partition(children = this.children) {
      return children.reduce((groups, child) => {
        groups[child.completed ? 'completed' : 'pending'].push(child);
        return groups;
      }, { pending: [], completed: [] });
    }

    renderGroups(renderItems, { key = this.id, open = false, title = '已完成' } = {}) {
      const groups = this.partition();
      return (groups.pending.length ? renderItems(groups.pending) : '') +
        (groups.completed.length ? LearningNode.renderFold(key, groups.completed.length, renderItems(groups.completed), open, title) : '');
    }

    static renderFold(key, count, content, open = false, title = '已完成') {
      return `<details class="completed-group" data-completed-group="${escape(key)}" ${open ? 'open' : ''}><summary><span>${escape(title)}</span><span class="completed-group-count">${count}</span>${icon('chevron')}</summary><div class="completed-group-content">${content}</div></details>`;
    }
  }

  class LearningTask extends LearningNode {}

  class LearningChapter extends LearningNode {
    constructor(chapter) {
      super(chapter, chapter.tasks.map((task) => new LearningTask(task)));
    }
  }

  class LearningStage extends LearningNode {
    constructor(subject, phase) {
      super({ id: `${subject.id}:${phase}` }, subject.chapters.filter(chapter => !phase || chapter.phase === phase).map(chapter => new LearningChapter(chapter)));
    }

    get progress() {
      const tasks = this.children.flatMap(chapter => chapter.children.map(node => ({ ...node.data, done: node.completed })));
      const summary = timeSummary(tasks);
      return { ...summary, percent: summary.minutes > 0 ? Math.round(summary.completedMinutes / summary.minutes * 1000) / 10 : null };
    }
  }

  function taskMode(task) {
    return new LearningTask(task).mode;
  }

  function taskModeControl(task) {
    const id = task.task_id || task.id;
    const mode = taskMode(task);
    return `<label class="task-mode-control"><span>任务类别</span><select data-task-mode="${escape(id)}" aria-label="任务类别：${escape(task.title)}"><option value="single-day" ${mode === 'single-day' ? 'selected' : ''}>单日任务</option><option value="multi-day" ${mode === 'multi-day' ? 'selected' : ''}>多日任务</option></select></label>`;
  }

  class TaskCardView {
    constructor(task, options = {}) {
      this.task = task;
      this.options = options;
      this.model = new LearningTask(task);
    }

    get id() { return this.model.id; }
    get mode() { return this.model.mode; }
    get completed() { return this.model.completed; }
    get variant() { return 'task'; }
    get timeTask() { return this.options.assignment || this.task; }

    status() {
      const tags = [this.mode === 'multi-day' ? '<span class="card-status is-multi">持续学习</span>' : '<span class="card-status">待学习</span>'];
      if (this.completed) tags.push('<span class="card-status is-done">已完成</span>');
      else if (this.timeTask.done) tags.push('<span class="card-status is-today">今日已打卡</span>');
      if (this.completed && this.mode !== 'multi-day') tags.shift();
      if (this.mode === 'multi-day' && this.variant === 'daily') tags.push(`<span class="card-progress">累计打卡 ${state.task_progress[this.id]?.checkins || 0} 天</span>`);
      return `<div class="card-status-row">${tags.join('')}</div>`;
    }

    title() {
      const chapter = this.options.chapter ? chapterLine(this.task, 'card-eyebrow') : '';
      return `<span class="card-titleblock">${chapter}<span class="card-title">${escape(this.task.title)}</span></span>`;
    }

    heading() { return `<div class="card-heading">${this.title()}</div>`; }

    content() {
      const task = this.task;
      const cleanText = (value) => String(value || '').trim().replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]*\n+/g, '\n');
      const detail = task.detail && cleanText(task.detail).replace(/\s/g, '') !== cleanText(task.title).replace(/\s/g, '') ? `<p class="card-detail">${escape(cleanText(task.detail))}</p>` : '';
      const metadata = [...new Set([task.kind, task.quantity, task.reference].map((value) => String(value || '').trim()).filter(Boolean))];
      const tags = metadata.length ? `<div class="card-metadata">${metadata.map((text) => `<span>${escape(text)}</span>`).join('')}</div>` : '';
      const notes = task.remarks && task.remarks !== task.detail ? `<details class="card-notes"><summary>学习备注${icon('chevron')}</summary><p>${escape(cleanText(task.remarks))}</p></details>` : '';
      return detail || tags || notes ? `<div class="card-content">${detail}${tags}${notes}</div>` : '';
    }

    timeCell(label, value, attributes = '', hint = '') {
      const tag = attributes ? 'button' : 'div';
      const classes = ['card-time-cell', label === '实际用时' ? 'is-actual' : '', /待|未/.test(value) ? 'is-unknown' : ''].filter(Boolean).join(' ');
      return `<${tag} class="${classes}" ${attributes ? `type="button" ${attributes}` : ''}><span>${escape(label)}</span><strong>${escape(value)}</strong>${hint ? `<small>${escape(hint)}</small>` : ''}</${tag}>`;
    }

    timing() {
      const estimate = taskEstimate(this.timeTask);
      const count = state.task_progress[this.id]?.checkins || 0;
      return `<div class="card-timing">${this.timeCell('预计用时', estimate.minutes === null ? '待补充' : formattedTime(estimate.minutes))}${this.timeCell('累计打卡', `${count} 天`)}</div>`;
    }

    completionButton(attributes) {
      return `<button type="button" class="card-complete-button" ${attributes} aria-pressed="${this.completed}" aria-label="${this.completed ? '取消完成' : '标记完成'}：${escape(this.task.title)}" title="只更新任务库进度，不改动当天用时或历史记录">${icon('check')}<span>${this.completed ? '取消完成' : '标记完成'}</span></button>`;
    }

    controls() { return ''; }
    footer() { return `<div class="card-footer">${this.timing()}${this.controls()}</div>`; }

    exportSnapshot() {
      const progress = state.task_progress[this.id];
      return {
        ...this.task,
        task_mode: this.mode,
        overall_completed: this.completed,
        checkin_days: progress?.checkins || 0,
        total_actual_minutes: progress?.actual_minutes || 0,
        export_context: this.variant,
      };
    }

    render() {
      const tag = this.variant === 'daily' ? 'li' : 'article';
      const classes = ['study-card', `${this.variant}-card`, this.completed ? 'is-finished' : '', this.options.selected ? 'is-selected' : '', this.timeTask.done ? 'is-checked-in' : ''].filter(Boolean).join(' ');
      return `<${tag} class="${classes}" data-card-key="${this.variant}:${escape(this.id)}" data-finished="${this.completed}">${this.status()}${this.heading()}${this.content()}${this.footer()}</${tag}>`;
    }
  }

  class DailyTaskCardView extends TaskCardView {
    get variant() { return 'daily'; }

    heading() {
      const task = this.task;
      return `<div class="card-heading"><label class="card-selection"><input id="daily-task-${escape(this.id)}" type="checkbox" data-task="${escape(this.id)}" ${task.done ? 'checked' : ''} aria-label="${escape(task.title)}，${task.done ? '今日已打卡' : '今日未打卡'}">${this.title()}</label><button type="button" class="card-remove" data-action="remove" data-task="${escape(this.id)}" aria-label="从今日清单移除：${escape(task.title)}" title="移除今日任务">${icon('close')}</button></div>`;
    }

    timing() {
      const estimate = taskEstimate(this.task);
      const actual = taskActual(this.task);
      return `<div class="card-timing">${this.timeCell('预计用时', estimate.minutes === null ? '待补充' : formattedTime(estimate.minutes), `data-action="edit-time" data-task="${escape(this.id)}" aria-label="安排今日用时：${escape(this.task.title)}"`, '调整')}${this.timeCell('实际用时', actual.recorded ? formattedTime(actual.minutes) : this.task.done ? '待补记' : '待打卡', `data-action="record-actual" data-task="${escape(this.id)}" aria-label="${this.task.done ? '修改' : '记录'}实际用时：${escape(this.task.title)}"`, this.task.done ? '修改' : '打卡')}</div>`;
    }

    controls() {
      return `<div class="card-controls">${taskModeControl(this.task)}${this.completionButton(`data-action="mark-complete" data-task="${escape(this.id)}"`)}</div>`;
    }
  }

  class LibraryTaskCardView extends TaskCardView {
    get variant() { return 'library'; }

    heading() {
      return `<div class="card-heading"><label class="card-selection"><input type="checkbox" data-library-task="${escape(this.id)}" ${this.options.selected ? 'checked' : ''} aria-label="选择今日任务：${escape(this.task.title)}">${this.title()}</label></div>`;
    }

    controls() {
      return `<div class="card-controls">${taskModeControl(this.task)}${this.completionButton(`data-library-complete="${escape(this.id)}"`)}</div>`;
    }
  }

  class HistoryTaskCardView extends TaskCardView {
    get variant() { return 'history'; }
    get mode() { return this.task.task_mode || canonicalTask(this.task)?.task_mode || 'single-day'; }
    get completed() { return Boolean(this.task.done); }

    exportSnapshot() {
      return {
        ...super.exportSnapshot(),
        overall_completed: this.mode === 'multi-day' ? Boolean(this.task.overall_completed) : Boolean(this.task.done),
        checkin_days: this.task.done ? 1 : 0,
        total_actual_minutes: this.task.done ? this.task.actual_minutes || 0 : 0,
        export_context: 'history',
      };
    }

    status() {
      return `<div class="card-status-row"><span class="card-status ${this.task.done ? 'is-done' : ''}">${this.task.done ? '当日已打卡' : '当日未打卡'}</span><span class="card-status">${this.mode === 'multi-day' ? '多日任务' : '单日任务'}</span></div>`;
    }

    timing() {
      const estimate = taskEstimate(this.task);
      const actual = taskActual(this.task);
      return `<div class="card-timing">${this.timeCell('预计用时', estimate.minutes === null ? '待补充' : formattedTime(estimate.minutes))}${this.timeCell('实际用时', actual.recorded ? formattedTime(actual.minutes) : this.task.done ? '未记录' : '未打卡')}</div>`;
    }
  }

  class CardMotion {
    static patch(container, html) {
      if (container.tagName !== 'TBODY' || !document.createElement) { container.innerHTML = html; return; }
      CardMotion.rowMarkup ||= new WeakMap();
      const incoming = document.createElement('tbody');
      incoming.innerHTML = html;
      const existing = new Map([...container.children].map((row) => [row.dataset.subjectRow, row]));
      const retained = new Set();
      [...incoming.children].forEach((next, index) => {
        const old = existing.get(next.dataset.subjectRow);
        const markup = next.outerHTML;
        const unchanged = old && (CardMotion.rowMarkup.get(old) || old.outerHTML) === markup;
        const row = unchanged ? old : next;
        if (old && !unchanged) old.replaceWith(row);
        if (container.children[index] !== row) container.insertBefore(row, container.children[index] || null);
        CardMotion.rowMarkup.set(row, markup);
        retained.add(row);
      });
      [...container.children].forEach((row) => { if (!retained.has(row)) row.remove(); });
    }

    static play(card, frames, options) {
      const animation = card.animate(frames, options);
      // Release temporary compositing after motion; resting text uses native rendering.
      animation.onfinish = () => animation.cancel();
      return animation;
    }

    static update(container, html) {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const active = document.activeElement;
      const activeCard = container.contains?.(active) ? active?.closest?.('[data-card-key]') : null;
      const focusIndex = activeCard ? [...activeCard.querySelectorAll('button,input,select,summary')].indexOf(active) : -1;
      const openNotes = new Set([...(container.querySelectorAll?.('.card-notes[open]') || [])].map((notes) => notes.closest('[data-card-key]').dataset.cardKey));
      const previous = new Map((reduced ? [] : [...(container.querySelectorAll?.('[data-card-key]') || [])]).map((card) => [card.dataset.cardKey, { rect: card.getBoundingClientRect(), finished: card.dataset.finished }]));
      CardMotion.patch(container, html);
      (container.querySelectorAll?.('[data-card-key]') || []).forEach((card) => {
        if (openNotes.has(card.dataset.cardKey)) { const notes = card.querySelector('.card-notes'); if (notes) notes.open = true; }
        if (activeCard && card.dataset.cardKey === activeCard.dataset.cardKey && focusIndex >= 0) {
          const target = card.querySelectorAll('button,input,select,summary')[focusIndex];
          const fold = card.closest('details');
          (fold && !fold.open ? fold.querySelector('summary') : target)?.focus({ preventScroll: true });
        }
      });
      if (reduced || !previous.size) return;
      let entered = 0;
      const viewportHeight = window.innerHeight || Infinity;
      const measured = [...(container.querySelectorAll?.('[data-card-key]') || [])].map((card) => ({ card, rect: card.getBoundingClientRect() }));
      measured.forEach(({ card, rect }) => {
        if (!card.animate || !rect.height || !rect.width || rect.bottom < -80 || rect.top > viewportHeight + 80 || entered >= 12) return;
        const before = previous.get(card.dataset.cardKey);
        if (!before || !before.rect.height) {
          CardMotion.play(card, [{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 230, delay: Math.min(entered++ * 22, 88), easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
        } else {
          const y = Math.round(before.rect.top - rect.top);
          if (Math.abs(y) > 2 && Math.abs(y) < 350) CardMotion.play(card, [{ transform: `translateY(${y}px)` }, { transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' });
          if (before.finished !== card.dataset.finished) CardMotion.play(card, [{ opacity: .65 }, { opacity: 1 }], { duration: 200 });
        }
      });
    }

    static toggleFold(details) {
      if (!details.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
      CardMotion.folds ||= new WeakMap();
      const current = CardMotion.folds.get(details);
      const opening = current ? !current.opening : !details.open;
      const start = details.getBoundingClientRect().height;
      current?.animation.cancel();
      details.open = true;
      details.style.overflow = 'hidden';
      const end = opening ? details.scrollHeight + 2 : details.querySelector('summary').getBoundingClientRect().height + 2;
      const animation = details.animate([{ height: `${start}px` }, { height: `${end}px` }], { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' });
      CardMotion.folds.set(details, { animation, opening });
      animation.onfinish = () => { details.open = opening; details.style.overflow = ''; CardMotion.folds.delete(details); };
      return true;
    }
  }

  function libraryTaskCompleted(taskId) {
    return new LearningTask({ task_id: taskId }).completed;
  }

  function renderDay() {
    if (!state) return;
    const { value } = dateParts(state.date);
    $('study-date').textContent = readableDate(state.date);
    $('study-date').dateTime = state.date;
    $('study-weekday').textContent = value.toLocaleDateString('zh-CN', { weekday: 'long' });
    const total = state.assignments.length;
    const completed = state.assignments.filter((assignment) => assignment.done).length;
    $('task-total').textContent = `${total} 项`;
    const duration = timeSummary(state.assignments);
    const allUnknown = !duration.known && duration.unknown;
    $('estimated-time').textContent = allUnknown ? '待补充' : formattedTime(duration.minutes);
    $('actual-time').textContent = !duration.actualKnown && duration.actualUnknown ? '待补记' : formattedTime(duration.actualMinutes || 0);
    const expanded = new Set([...document.querySelectorAll('#daily-tbody details[data-completed-group][open]')].map((group) => group.dataset.completedGroup));
    CardMotion.update($('daily-tbody'), library.map((subject) => {
      const tasks = subjectAssignments(subject.id);
      const done = tasks.filter((task) => task.done).length;
      const allDone = tasks.length && done === tasks.length;
      const subjectLabel = tasks.length ? `${subjectName(subject)}，${allDone ? '取消该科全部完成' : '完成该科全部任务'}` : `${subjectName(subject)}，选择章节任务`;
      const group = new LearningNode({ id: `daily:${state.date}:${subject.id}` }, tasks.map((task) => new LearningTask(task)));
      const taskRows = (entries) => `<ul class="task-list">${entries.map((task) => new DailyTaskCardView(task, { chapter: true }).render()).join('')}</ul>`;
      const groupKey = `daily:${state.date}:${subject.id}`;
      const taskContent = group.renderGroups((nodes) => taskRows(nodes.map((node) => node.data)), { key: groupKey, open: expanded.has(groupKey) });
      return `<tr data-subject-row="${escape(subject.id)}" class="${tasks.length ? 'has-tasks' : ''} ${allDone ? 'is-complete' : ''}">
        <td class="subject-cell"><div class="subject-control"><button type="button" class="subject-button" data-action="subject" data-subject="${escape(subject.id)}" aria-label="${escape(subjectLabel)}"><strong class="subject-name">${escape(subjectName(subject))}</strong></button><button type="button" class="add-task-button" data-action="choose" data-subject="${escape(subject.id)}" aria-label="选择${escape(subjectName(subject))}的章节任务" title="选择章节任务">${icon('plus')}</button></div></td>
        <td>${tasks.length ? taskContent : `<div class="empty-row"><span>还没有安排任务</span><button type="button" class="empty-choose" data-action="choose" data-subject="${escape(subject.id)}">选择章节任务${icon('chevron')}</button></div>`}</td>
        <td class="row-progress">${allDone ? `<span class="all-done-icon" aria-label="${done} 项全部完成">${icon('check')}</span>` : tasks.length ? `<span class="done-count">${done}</span><span class="total-count"> / ${tasks.length}</span>` : '<span class="zero-count">—</span>'}</td>
      </tr>`;
    }).join(''));
    $('completion-text').innerHTML = total ? (completed === total ? `今日 <strong>${total}</strong> 项任务已全部完成` : `已完成 <strong>${completed}</strong> / ${total} 项任务`) : '今天，从一项任务开始';
    $('summary-progress-fill').style.width = total ? `${completed / total * 100}%` : '0%';
    $('action-note').textContent = completed && completed === total ? '今天的任务都完成了，给这份坚持留个记录。' : '任务会自动保存，可以随时回来继续。';
    updateControls();
  }

  function changed() {
    dirty = true;
    changeVersion += 1;
    setStatus('saving', '正在保存');
    clearError();
    renderDay();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { flushAutosave().catch(() => {}); }, 450);
  }

  async function recoverConflict() {
    const fresh = normaliseState(await api('/api/state'));
    state = fresh;
    dirty = false;
    changeVersion += 1;
    closeDialog('library-dialog');
    closeDialog('archive-dialog');
    closeDialog('estimate-dialog');
    closeDialog('completion-dialog');
    estimateDraft = null;
    completionDraft = null;
    renderDay();
    setStatus('saved', '已同步最新记录');
    showError('另一个窗口更新了学习记录，页面已同步。请确认清单后再操作。');
    showToast('已同步其他窗口的最新记录，请重新操作。');
  }

  async function flushAutosave() {
    window.clearTimeout(saveTimer);
    if (savePromise) {
      await savePromise;
      if (dirty) return flushAutosave();
      return;
    }
    if (!dirty || !state) return;
    const version = changeVersion;
    const snapshot = { date: state.date, revision: state.revision, assignments: cloneAssignments(), library_completed_ids: [...state.library_completed_ids], library_reopened_ids: [...state.library_reopened_ids], task_modes: { ...state.task_modes }, subject_phases: { ...state.subject_phases } };
    setStatus('saving', '正在保存');
    savePromise = (async () => {
      try {
        const saved = normaliseState(await api('/api/state', { method: 'PUT', body: JSON.stringify(snapshot) }));
        if (version === changeVersion) {
          state = saved;
          dirty = false;
        } else {
          state.revision = saved.revision;
          state.history = saved.history;
          state.completed_ids = saved.completed_ids;
        }
        clearError();
        if (!dirty) setStatus('saved', '已自动保存');
      } catch (error) {
        if (error.status === 409) {
          await recoverConflict();
        } else {
          setStatus('error', '尚未保存');
          showError(`自动保存未完成：${error.message}`, () => flushAutosave());
        }
        throw error;
      } finally {
        savePromise = null;
      }
    })();
    await savePromise;
    if (dirty) return flushAutosave();
  }

  function openDialog(id, opener = document.activeElement) {
    const dialog = $(id);
    if (dialog.open) return;
    dialogOpeners.set(id, opener);
    dialog.showModal();
  }

  function closeDialog(id) {
    if ($(id).open) $(id).close();
  }

  function chooseSubject(id) {
    if (actionBusy || !state) return;
    const subject = library.find((item) => item.id === id);
    if (!subject) return;
    const available = new Set(subject.chapters.flatMap((chapter) => chapter.tasks.map((task) => task.id)));
    const selected = new Set(subjectAssignments(id).filter((assignment) => available.has(assignment.task_id)).map((assignment) => assignment.task_id));
    const firstSelected = subject.chapters.find((chapter) => !new LearningChapter(chapter).completed && chapter.tasks.some((task) => selected.has(task.id)));
    const nextChapter = subject.chapters.find((chapter) => chapter.tasks.some((task) => !libraryTaskCompleted(task.id)));
    const phases = [...new Set(subject.chapters.map(chapter => chapter.phase).filter(Boolean))];
    const phase = state.subject_phases[id] ?? (nextChapter?.phase || phases[0] || '');
    subjectDraft = { subject, selected, chapterId: firstSelected?.id || nextChapter?.id || subject.chapters[0]?.id, query: '', phase };
    $('library-title').textContent = `${subjectName(subject)} · 选择学习任务`;
    $('library-search').value = '';
    $('library-phase').innerHTML = '<option value="">全部阶段</option>' + [...new Set(subject.chapters.map((chapter) => chapter.phase).filter(Boolean))].map((phase) => `<option value="${escape(phase)}">${escape(phase)}</option>`).join('');
    $('library-phase').value = phase;
    $('library-subject-count').textContent = `${subject.chapters.length} 个章节`;
    renderLibrary();
    openDialog('library-dialog');
    $('library-search').focus({ preventScroll: true });
  }

  function matchesSearch(chapter, task = null) {
    const query = subjectDraft.query.trim().toLocaleLowerCase();
    if (!query) return true;
    const index = catalogue();
    return index.text(chapter, ['title', 'phase']).includes(query) || Boolean(task && index.text(task, ['title', 'detail', 'reference', 'quantity', 'remarks']).includes(query));
  }

  function filteredChapters() {
    return subjectDraft.subject.chapters.filter((chapter) => (!subjectDraft.phase || chapter.phase === subjectDraft.phase) && (matchesSearch(chapter) || chapter.tasks.some((task) => matchesSearch(chapter, task))));
  }

  function visibleTasks(chapter) {
    return chapter.tasks.filter((task) => matchesSearch(chapter, task));
  }

  function updateSelectionSummary() {
    const size = subjectDraft.selected.size;
    const selected = [...subjectDraft.selected].map((id) => catalogue().tasks.get(id)?.task).filter(Boolean);
    $('selection-summary').innerHTML = `已选 <strong>${size}</strong> 项任务<span class="selection-time">${escape(summaryText(selected))}</span>`;
    $('apply-library').innerHTML = `${subjectAssignments(subjectDraft.subject.id).length ? '更新今日清单' : '加入今日清单'}${icon('arrow')}`;
  }

  function updateChapterSelectionBadge() {
    const chapter = subjectDraft.subject.chapters.find((item) => item.id === subjectDraft.chapterId);
    if (!chapter) return;
    const button = [...$('chapter-list').querySelectorAll('[data-chapter]')].find((item) => item.dataset.chapter === chapter.id);
    if (!button) return;
    const count = chapter.tasks.filter((task) => subjectDraft.selected.has(task.id)).length;
    let badge = button.querySelector('.chapter-selected');
    if (!count) { badge?.remove(); return; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'chapter-selected'; button.append(badge); }
    badge.textContent = count;
    badge.setAttribute('aria-label', `已选 ${count} 项`);
  }

  function renderLibraryNavigation() {
    const chapters = filteredChapters().map((chapter) => new LearningChapter(chapter));
    const subject = new LearningNode(subjectDraft.subject, chapters);
    const groupKey = `chapters:${subjectDraft.subject.id}`;
    const previousGroup = $('chapter-list').querySelector('details[data-completed-group]');
    const open = previousGroup?.dataset.completedGroup === groupKey && previousGroup.open;
    const renderChapters = (nodes) => nodes.map((node) => {
      const chapter = node.data;
      const chosen = chapter.tasks.filter((task) => subjectDraft.selected.has(task.id)).length;
      return `<button type="button" class="chapter-button" data-chapter="${escape(chapter.id)}" aria-current="${chapter.id === subjectDraft.chapterId}"><span>${chapter.phase ? `<span class="chapter-phase">${escape(chapter.phase)}</span>` : ''}<span>${escape(chapter.title)}</span></span>${chosen ? `<span class="chapter-selected" aria-label="已选 ${chosen} 项">${chosen}</span>` : ''}</button>`;
    }).join('');
    $('chapter-list').innerHTML = chapters.length ? subject.renderGroups(renderChapters, { key: groupKey, open, title: '已完成章节' }) : '<div class="empty-state"><p>没有匹配的章节</p></div>';
  }

  function renderLibraryContent() {
    const chapter = subjectDraft.subject.chapters.find((item) => item.id === subjectDraft.chapterId);
    if (!chapter) {
      $('chapter-content').innerHTML = `<div class="empty-state">${icon('search')}<strong>${subjectDraft.query ? '没有找到匹配的任务' : '这个科目还没有章节任务'}</strong><p>${subjectDraft.query ? '换一个关键词试试。' : '任务库准备好后会显示在这里。'}</p></div>`;
      return;
    }
    const tasks = visibleTasks(chapter);
    const chapterNode = new LearningChapter(chapter);
    const visibleIds = new Set(tasks.map((task) => task.id));
    const visible = new LearningNode({ id: chapter.id }, chapterNode.children.filter((node) => visibleIds.has(node.id)));
    const pending = visible.partition().pending.map((node) => node.data);
    const allChosen = pending.length && pending.every((task) => subjectDraft.selected.has(task.id));
    const groupKey = `library:${subjectDraft.subject.id}:${chapter.id}`;
    const previousGroup = $('chapter-content').querySelector('details[data-completed-group]');
    const expanded = previousGroup?.dataset.completedGroup === groupKey && previousGroup.open;
    const today = new Map(subjectAssignments(subjectDraft.subject.id).map((task) => [task.task_id, task]));
    const taskCards = (entries) => `<div class="library-tasks">${entries.map((task) => new LibraryTaskCardView(task, { assignment: today.get(task.id), selected: subjectDraft.selected.has(task.id) }).render()).join('')}</div>`;
    CardMotion.update($('chapter-content'), `<div class="chapter-heading"><div><h3>${escape(chapter.title)}</h3><p>${subjectDraft.query ? `找到 ${tasks.length} 项任务` : `${tasks.length} 项学习任务`}</p></div>${pending.length ? `<button class="text-button" id="toggle-chapter" type="button">${allChosen ? '取消未完成全选' : '全选未完成'}</button>` : ''}</div>${visible.renderGroups((nodes) => taskCards(nodes.map((node) => node.data)), { key: groupKey, open: expanded })}`);
  }

  function renderLibrary() {
    window.clearTimeout(searchTimer);
    const chapters = filteredChapters();
    if (!chapters.some((chapter) => chapter.id === subjectDraft.chapterId)) subjectDraft.chapterId = chapters[0]?.id;
    renderLibraryNavigation();
    renderLibraryContent();
    updateSelectionSummary();
    const progress = new LearningStage(subjectDraft.subject, subjectDraft.phase).progress;
    const percent = progress.percent === null ? '—' : `${progress.percent}%`;
    $('stage-progress').innerHTML = `<div class="stage-progress-heading"><strong>${escape(subjectDraft.phase || '全部阶段')} · 预计用时完成度</strong><strong>${percent}</strong></div><progress max="100" value="${progress.percent ?? 0}" aria-label="当前阶段按预计用时计算的完成百分比">${percent}</progress><p>已完成 ${escape(formattedTime(progress.completedMinutes))} / 共 ${escape(formattedTime(progress.minutes))}${progress.unknown ? ` · ${progress.unknown}项未设置预计用时，暂未计入` : ''}${progress.percent === null ? ' · 暂无可计算的预计用时' : ''}</p>`;
  }

  function refreshLibraryCompletion(taskId) {
    const scrollTop = $('chapter-content').scrollTop;
    const restoreFocus = document.activeElement?.dataset.libraryComplete === taskId;
    renderLibrary();
    $('chapter-content').scrollTop = scrollTop;
    if (restoreFocus) {
      const button = [...$('chapter-content').querySelectorAll('[data-library-complete]')].find((item) => item.dataset.libraryComplete === taskId);
      const group = button?.closest('details');
      (group && !group.open ? group.querySelector('summary') : button)?.focus({ preventScroll: true });
    }
  }

  async function toggleLibraryCompletion(taskId) {
    if (!state || actionBusy || !canonicalTask({ task_id: taskId })) return;
    const draft = subjectDraft;
    const fromLibrary = Boolean(draft && $('library-dialog').open);
    const complete = new LearningTask({ task_id: taskId }).toggleCompleted();
    changed();
    const version = changeVersion;
    if (fromLibrary) refreshLibraryCompletion(taskId);
    try {
      await flushAutosave();
      if (version !== changeVersion) return;
      if (fromLibrary && subjectDraft === draft && $('library-dialog').open) refreshLibraryCompletion(taskId);
      renderDay();
      showToast(complete ? '已保存任务库完成标记，不计入今日清单。' : '已取消任务库完成标记。', null, 3500);
    } catch (error) {
      if (error.status !== 409) showToast('本次修改尚未保存，请查看页面提示后重试。', null, 6500);
    }
  }

  function applyLibrary() {
    if (!subjectDraft || actionBusy) return;
    const id = subjectDraft.subject.id;
    const existing = new Map(subjectAssignments(id).map((assignment) => [assignment.task_id, assignment]));
    const available = new Set(subjectDraft.subject.chapters.flatMap((chapter) => chapter.tasks.map((task) => task.id)));
    const preserved = subjectAssignments(id).filter((assignment) => !available.has(assignment.task_id));
    const replacement = [];
    subjectDraft.subject.chapters.forEach((chapter) => chapter.tasks.forEach((task) => {
      if (subjectDraft.selected.has(task.id)) {
        const estimate = taskEstimate(existing.get(task.id) || task);
        replacement.push({ ...(existing.get(task.id) || { task_id: task.id, subject_id: id, chapter_id: chapter.id, title: task.title, detail: task.detail || '', done: false }), subject_name: subjectDraft.subject.name, chapter_title: chapter.title, task_mode: taskMode(task), estimated_minutes: estimate.minutes, estimated_source: estimate.source || '', estimate_group: estimate.group || null });
      }
    }));
    state.assignments = state.assignments.filter((assignment) => assignment.subject_id !== id).concat(replacement, preserved);
    closeDialog('library-dialog');
    changed();
    [...document.querySelectorAll('.add-task-button')].find((element) => element.dataset.subject === id)?.focus({ preventScroll: true });
    showToast(replacement.length ? `${subjectName(subjectDraft.subject)}已安排 ${replacement.length} 项任务。${preserved.length ? '既有记录已保留。' : ''}` : preserved.length ? '可选任务已清空，既有记录已保留。' : `已清空${subjectName(subjectDraft.subject)}今天的任务。`, null, 3000);
  }

  function historyEntries() {
    return [...state.history].sort((a, b) => b.date.localeCompare(a.date));
  }

  function renderHistoryList() {
    const entries = historyEntries();
    $('history-list').innerHTML = entries.map((entry) => `<button class="history-date-button" type="button" data-history-date="${escape(entry.date)}" aria-current="${entry.date === historyDate}"><span><strong>${escape(readableDate(entry.date))}</strong><small>完成 ${entry.completed} / ${entry.total} 项</small></span>${icon('chevron')}</button>`).join('');
    $('history-summary').textContent = entries.length ? `已记录 ${entries.length} 天` : '从今天开始积累';
  }

  async function selectHistoryDate(date) {
    const restoreHistoryFocus = $('history-list').contains(document.activeElement);
    historyDate = date;
    historyRecord = null;
    const request = ++historyRequest;
    renderHistoryList();
    if (restoreHistoryFocus) [...document.querySelectorAll('[data-history-date]')].find((element) => element.dataset.historyDate === date)?.focus({ preventScroll: true });
    $('export-history-button').hidden = true;
    $('history-content').innerHTML = '<div class="empty-state"><span class="loading-spinner" aria-hidden="true"></span><p>正在载入这一天的记录</p></div>';
    try {
      const record = await api(`/api/history/${encodeURIComponent(date)}`);
      if (request !== historyRequest || !$('history-dialog').open) return;
      historyRecord = record;
      const assignments = Array.isArray(record.assignments) ? record.assignments : [];
      const completed = assignments.filter((assignment) => assignment.done).length;
      $('history-content').innerHTML = `<div class="history-detail-heading"><h3>${escape(readableDate(date))}</h3><span>完成 ${completed} / ${assignments.length} 项任务<small class="history-time-line">${escape(summaryText(assignments))} / ${escape(actualSummaryText(assignments))}</small></span></div>${assignments.length ? library.map((subject) => {
        const tasks = subjectAssignments(subject.id, assignments);
        if (!tasks.length) return '';
        return `<section class="history-subject"><h4 class="subject-name">${escape(subjectName(subject))}</h4>${tasks.map((task) => new HistoryTaskCardView(task, { chapter: true }).render()).join('')}</section>`;
      }).join('') : `<div class="empty-state">${icon('book')}<strong>这一天没有安排任务</strong></div>`}`;
      $('export-history-button').hidden = !assignments.length;
      updateControls();
    } catch (error) {
      if (request !== historyRequest) return;
      $('history-content').innerHTML = `<div class="empty-state">${icon('folder')}<strong>记录暂时没有载入</strong><p>${escape(error.message)}</p><button type="button" class="text-button" id="retry-history">重新载入</button></div>`;
    }
  }

  function openHistory() {
    if (!state || actionBusy) return;
    const entries = historyEntries();
    historyDate = entries.some((entry) => entry.date === historyDate) ? historyDate : entries[0]?.date;
    renderHistoryList();
    openDialog('history-dialog');
    if (historyDate) selectHistoryDate(historyDate);
    else {
      historyRecord = null;
      $('history-content').innerHTML = `<div class="empty-state">${icon('book')}<strong>还没有保存过的学习记录</strong><p>完成今天后，点击“保存并进入下一天”，<br>这一天的清单就会留在这里。</p></div>`;
      $('export-history-button').hidden = true;
    }
  }

  function setBusy(busy, action = '') {
    actionBusy = busy;
    updateControls();
    $('export-button').innerHTML = `${busy && action === 'export' ? '<span class="loading-spinner" aria-hidden="true"></span>' : icon('image')}<span>${busy && action === 'export' ? '正在导出' : '导出今日图片'}</span>`;
    $('archive-button').innerHTML = `<span>${busy && action === 'archive' ? '正在保存' : '保存并进入下一天'}</span>${busy && action === 'archive' ? '<span class="loading-spinner" aria-hidden="true"></span>' : icon('arrow')}`;
  }

  async function archiveDay(carryPending) {
    if (actionBusy || !state) return;
    setBusy(true, 'archive');
    closeDialog('archive-dialog');
    closeDialog('completion-dialog');
    completionDraft = null;
    try {
      await flushAutosave();
      const previousDate = state.date;
      state = normaliseState(await api('/api/archive', { method: 'POST', body: JSON.stringify({ date: state.date, revision: state.revision, carry_pending: carryPending }) }));
      dirty = false;
      changeVersion += 1;
      clearError();
      setStatus('saved', '已自动保存');
      renderDay();
      showToast(`${readableDate(previousDate)} 已保存，开始新的一天。`, null, 5500);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      if (error.status === 409) {
        if (!String($('error-text').textContent).includes('另一个窗口')) await recoverConflict().catch(() => {});
      } else showError(`今天还没有归档：${error.message}`, () => archiveDay(carryPending));
    } finally {
      setBusy(false);
    }
  }

  function requestArchive() {
    if (actionBusy || !state) return;
    const pending = state.assignments.filter((assignment) => !assignment.done).length;
    if (!pending) {
      archiveDay(false);
      return;
    }
    $('archive-description').textContent = `今天共安排 ${state.assignments.length} 项任务，已完成 ${state.assignments.length - pending} 项，还有 ${pending} 项未完成。`;
    $('carry-pending').checked = true;
    openDialog('archive-dialog');
  }

  async function exportDay(date, isCurrent) {
    if (actionBusy || !state) return;
    setBusy(true, 'export');
    const historyButtonText = $('export-history-button').innerHTML;
    if (!isCurrent) $('export-history-button').innerHTML = '<span class="loading-spinner" aria-hidden="true"></span>正在导出';
    try {
      await flushAutosave();
      const record = isCurrent ? { date: state.date, assignments: cloneAssignments() } : await api(`/api/history/${encodeURIComponent(date)}`);
      record.assignments = record.assignments.map((task) => new (isCurrent ? DailyTaskCardView : HistoryTaskCardView)(task).exportSnapshot());
      record.compact408 = $('compact-export').checked;
      const result = await window.StudyImage.exportDaily(record);
      if (!result.files?.length) throw new Error('没有收到图片保存结果，请重试。');
      clearError();
      if (isCurrent) setStatus('saved', '已自动保存');
      const destination = result.destination === 'directory' ? `已保存到“${result.directoryName || '所选文件夹'}”` : '已开始下载，请查看浏览器下载记录';
      const label = result.archiveName ? `图片压缩包（${result.files.length} 张）` : (result.files.length > 1 ? `${result.files.length} 张图片` : '打卡图片');
      showToast(`${label}${destination}。${result.warning || ''}`, null, 14000);
    } catch (error) {
      if (error.status === 409) {
        if (!String($('error-text').textContent).includes('另一个窗口')) await recoverConflict().catch(() => {});
      } else {
        showError(`图片还没有导出：${error.message}`, () => exportDay(date, isCurrent));
        showToast(`导出未完成：${error.message}`, null, 8000);
      }
    } finally {
      $('export-history-button').innerHTML = historyButtonText;
      setBusy(false);
    }
  }

  function downloadBackup(value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `交大学习记录备份_${state.date}_${Date.now()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function updateDirectoryInfo() {
    try {
      const info = await window.StudyImage.getDirectoryInfo();
      $('directory-button').hidden = !info.supported;
      $('clear-directory-button').hidden = !info.configured;
      $('directory-status').textContent = info.configured ? `导出的打卡图片会优先保存到“${info.name}”。` : '图片将按浏览器的下载设置保存。';
      $('directory-hint').textContent = info.supported ? '选择一次文件夹，之后导出图片会优先保存到这里。' : '当前浏览器使用普通下载；需要固定保存到桌面时，可在 Chrome 或 Edge 中选择文件夹。';
    } catch (error) {
      $('directory-status').textContent = `保存位置暂时无法读取：${error.message}`;
    }
  }

  async function dataAction(callback) {
    if (!state || actionBusy) return;
    setBusy(true);
    const buttons = [...document.querySelectorAll('#backup-button,#import-button,#directory-button,#clear-directory-button')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await flushAutosave();
      await callback();
    } catch (error) {
      if (error.status === 409) await recoverConflict().catch(() => {});
      showToast(error.message || '操作没有完成，请重试。', null, 9000);
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
      setBusy(false);
    }
  }

  async function load() {
    const request = ++loadRequest;
    const version = changeVersion;
    const canApply = () => request === loadRequest && version === changeVersion && !dirty && !savePromise && !actionBusy;
    clearError();
    $('task-sheet').setAttribute('aria-busy', 'true');
    setStatus('saving', '正在载入');
    try {
      const [libraryResult, stateResult] = await Promise.all([api('/api/library'), api('/api/state')]);
      if (!canApply()) return;
      if (!Array.isArray(libraryResult.subjects)) throw new Error('章节任务库的格式不正确。');
      if (!preparedCatalogues.has(libraryResult)) preparedCatalogues.set(libraryResult, { subjects: SUBJECT_NAMES.map((name) => libraryResult.subjects.find((subject) => subject.name === name)).filter(Boolean).map((subject) => ({ ...subject, chapters: Array.isArray(subject.chapters) ? subject.chapters.map((chapter) => ({ ...chapter, tasks: Array.isArray(chapter.tasks) ? chapter.tasks : [] })) : [] })), retired: new Map((libraryResult.metadata?.retired_tasks || []).map((task) => [task.id, task])) });
      const prepared = preparedCatalogues.get(libraryResult);
      const freshLibrary = prepared.subjects;
      const freshRetired = prepared.retired;
      if (freshLibrary.length !== SUBJECT_NAMES.length) throw new Error('章节任务库缺少科目，请重新载入任务库。');
      const fresh = normaliseState(stateResult);
      if (state && fresh.revision < state.revision) return;
      const externalUpdate = state && fresh.revision !== state.revision;
      if (externalUpdate) {
        const choosing = $('library-dialog').open;
        const editingEstimate = $('estimate-dialog').open;
        const recordingCompletion = $('completion-dialog').open;
        closeDialog('library-dialog');
        closeDialog('archive-dialog');
        closeDialog('estimate-dialog');
        closeDialog('completion-dialog');
        subjectDraft = null;
        estimateDraft = null;
        completionDraft = null;
        if (choosing) showToast('另一页面更新了学习记录，请按最新进度重新选择任务。', null, 6500);
        else if (editingEstimate) showToast('另一页面更新了学习记录，请按最新清单重新安排用时。', null, 6500);
        else if (recordingCompletion) showToast('另一页面更新了学习记录，请按最新清单重新打卡。', null, 6500);
      }
      library = freshLibrary;
      retiredTasks = freshRetired;
      state = fresh;
      dirty = false;
      renderDay();
      setStatus('saved', '已自动保存');
    } catch (error) {
      if (!canApply()) return;
      setStatus('error', '载入未完成');
      $('daily-tbody').innerHTML = `<tr><td colspan="3"><div class="empty-state">${icon('book')}<strong>学习清单暂时没有载入</strong><p>请检查网络及浏览器存储权限，再点上方“重试”。</p></div></td></tr>`;
      showError(error.message, load);
      $('task-sheet').setAttribute('aria-busy', 'false');
    } finally {
      if (request === loadRequest && state) {
        updateControls();
        if (!dirty && !savePromise && !actionBusy && $('save-status').dataset.status === 'saving') setStatus('saved', '已自动保存');
      }
    }
  }

  function handleTaskModeChange(event) {
    const input = event.target.closest('[data-task-mode]');
    if (!input) return false;
    if (!state || actionBusy || !['single-day', 'multi-day'].includes(input.value)) return true;
    new LearningTask({ task_id: input.dataset.taskMode }).setMode(input.value);
    changed();
    if (subjectDraft && $('library-dialog').open) renderLibrary();
    flushAutosave().then(() => showToast('任务类别已保存。')).catch(() => {});
    return true;
  }



  $('daily-tbody').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || actionBusy || !state) return;
    const { action, subject: subjectId, task: taskId } = button.dataset;
    if (action === 'choose') chooseSubject(subjectId);
    else if (action === 'subject') {
      const assignments = subjectAssignments(subjectId);
      if (!assignments.length) chooseSubject(subjectId);
      else {
        const allDone = assignments.every((assignment) => assignment.done);
        if (allDone) undoCompletion(assignments);
        else openCompletion(assignments.filter((task) => !task.done).map((task) => task.task_id));
        const replacement = [...document.querySelectorAll('.subject-button')].find((element) => element.dataset.subject === subjectId);
        replacement?.focus({ preventScroll: true });
      }
    } else if (action === 'mark-complete') toggleLibraryCompletion(taskId);
    else if (action === 'edit-time') openEstimate(taskId);
    else if (action === 'record-actual') {
      const task = state.assignments.find((item) => item.task_id === taskId);
      if (task) openCompletion([taskId], task.done ? 'edit' : 'complete');
    }
    else if (action === 'remove') {
      const removedSubject = state.assignments.find((assignment) => assignment.task_id === taskId)?.subject_id;
      state.assignments = state.assignments.filter((assignment) => assignment.task_id !== taskId);
      changed();
      [...document.querySelectorAll('.add-task-button')].find((element) => element.dataset.subject === removedSubject)?.focus({ preventScroll: true });
    }
  });

  $('daily-tbody').addEventListener('change', (event) => {
    if (handleTaskModeChange(event)) return;
    const input = event.target.closest('input[data-task]');
    if (!input || actionBusy || !state) return;
    const assignment = state.assignments.find((item) => item.task_id === input.dataset.task);
    if (!assignment) return;
    const complete = input.checked;
    input.checked = assignment.done;
    const taskId = input.dataset.task;
    if (complete) openCompletion([taskId]);
    else undoCompletion([assignment]);
    [...document.querySelectorAll('#daily-tbody input[data-task]')].find((element) => element.dataset.task === taskId)?.focus({ preventScroll: true });
  });

  document.addEventListener('click', (event) => {
    const summary = event.target.closest('summary');
    const details = summary?.parentElement;
    if (details?.matches('details.completed-group, details.card-notes') && CardMotion.toggleFold(details)) event.preventDefault();
  });

  $('library-search').addEventListener('input', (event) => {
    if (!subjectDraft) return;
    subjectDraft.query = event.target.value;
    const draft = subjectDraft;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => { if (subjectDraft === draft && $('library-dialog').open) renderLibrary(); }, 90);
  });
  $('library-phase').addEventListener('change', (event) => {
    if (!subjectDraft || !state || actionBusy) return;
    subjectDraft.phase = event.target.value;
    state.subject_phases[subjectDraft.subject.id] = subjectDraft.phase;
    changed();
    renderLibrary();
    $('chapter-list').scrollTop = 0;
    $('chapter-content').scrollTop = 0;
  });
  $('chapter-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-chapter]');
    if (!button || !subjectDraft) return;
    subjectDraft.chapterId = button.dataset.chapter;
    renderLibrary();
    $('chapter-content').scrollTop = 0;
    const current = [...$('chapter-list').querySelectorAll('[data-chapter]')].find((element) => element.dataset.chapter === subjectDraft.chapterId);
    const completed = current?.closest('details');
    (completed && !completed.open ? completed.querySelector('summary') : current)?.focus({ preventScroll: true });
  });
  $('chapter-content').addEventListener('change', (event) => {
    if (handleTaskModeChange(event)) return;
    const input = event.target.closest('[data-library-task]');
    if (!input || !subjectDraft) return;
    if (input.checked) subjectDraft.selected.add(input.dataset.libraryTask);
    else subjectDraft.selected.delete(input.dataset.libraryTask);
    input.closest('.study-card').classList.toggle('is-selected', input.checked);
    updateChapterSelectionBadge();
    updateSelectionSummary();
    const chapter = subjectDraft.subject.chapters.find((item) => item.id === subjectDraft.chapterId);
    const tasks = visibleTasks(chapter).filter((task) => !libraryTaskCompleted(task.id));
    if ($('toggle-chapter')) $('toggle-chapter').textContent = tasks.every((task) => subjectDraft.selected.has(task.id)) ? '取消未完成全选' : '全选未完成';
  });
  $('chapter-content').addEventListener('click', (event) => {
    const completion = event.target.closest('[data-library-complete]');
    if (completion) { toggleLibraryCompletion(completion.dataset.libraryComplete); return; }
    if (!event.target.closest('#toggle-chapter') || !subjectDraft) return;
    const chapter = subjectDraft.subject.chapters.find((item) => item.id === subjectDraft.chapterId);
    const tasks = visibleTasks(chapter).filter((task) => !libraryTaskCompleted(task.id));
    const allChosen = tasks.every((task) => subjectDraft.selected.has(task.id));
    tasks.forEach((task) => allChosen ? subjectDraft.selected.delete(task.id) : subjectDraft.selected.add(task.id));
    renderLibrary();
    $('toggle-chapter')?.focus({ preventScroll: true });
  });

  $('apply-library').addEventListener('click', applyLibrary);
  $('estimate-form').addEventListener('submit', (event) => { event.preventDefault(); editEstimate(false); });
  $('completion-form').addEventListener('submit', (event) => { event.preventDefault(); saveCompletion(); });
  $('reset-estimate').addEventListener('click', () => editEstimate(true));
  $('data-button').addEventListener('click', () => {
    openDialog('data-dialog');
    updateDirectoryInfo();
  });
  $('backup-button').addEventListener('click', () => dataAction(async () => {
    downloadBackup(await window.StudyStore.exportBackup());
    showToast('全部学习记录已开始下载。');
  }));
  $('import-button').addEventListener('click', () => { if (!actionBusy) $('backup-file').click(); });
  $('backup-file').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    dataAction(async () => {
      if (file.size > 50 * 1024 * 1024) throw new Error('备份文件超过 50 MB，请确认选中了学习记录备份。');
      let value;
      try { value = JSON.parse(await file.text()); } catch { throw new Error('这个文件不是有效的 JSON 备份，请重新选择。'); }
      state = normaliseState(await window.StudyStore.importBackup(value, { replace: false, revision: state.revision }));
      dirty = false;
      changeVersion += 1;
      renderDay();
      setStatus('saved', '已自动保存');
      clearError();
      showToast('备份已合并，任务与打卡进度都已保存。', null, 6500);
    });
  });
  $('directory-button').addEventListener('click', async () => {
    try {
      const result = await window.StudyImage.chooseDirectory();
      await updateDirectoryInfo();
      if (!result?.cancelled) showToast(`图片保存位置已设置。${result.warning || ''}`, null, result.warning ? 10000 : 5000);
    } catch (error) { showToast(`没有更改保存位置：${error.message}`, null, 7000); }
  });
  $('clear-directory-button').addEventListener('click', async () => {
    try { await window.StudyImage.clearDirectory(); await updateDirectoryInfo(); showToast('已恢复普通下载。'); }
    catch (error) { showToast(error.message, null, 7000); }
  });
  window.addEventListener('study-store-changed', () => {
    if (!dirty && !savePromise && !actionBusy) load();
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    $('install-button').hidden = false;
  });
  $('install-button').addEventListener('click', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') showToast('已添加桌面入口，以后可以直接打开。');
    installPrompt = null;
    $('install-button').hidden = true;
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; $('install-button').hidden = true; });
  $('history-button').addEventListener('click', openHistory);
  $('history-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-history-date]');
    if (button) selectHistoryDate(button.dataset.historyDate);
  });
  $('history-content').addEventListener('click', (event) => { if (event.target.closest('#retry-history') && historyDate) selectHistoryDate(historyDate); });
  $('export-button').addEventListener('click', () => exportDay(state.date, true));
  $('export-history-button').addEventListener('click', () => { if (historyDate) exportDay(historyDate, false); });
  $('archive-button').addEventListener('click', requestArchive);
  $('confirm-archive').addEventListener('click', () => archiveDay($('carry-pending').checked));
  $('retry-button').addEventListener('click', async () => {
    if (!errorRetry) return;
    $('retry-button').disabled = true;
    try { await errorRetry(); } catch {} finally { $('retry-button').disabled = false; }
  });
  $('toast-close').addEventListener('click', () => { $('toast').hidden = true; });
  $('toast-action').addEventListener('click', () => { if (toastAction) toastAction(); });
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeDialog(button.dataset.close)));
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => {
      if (dialog.id === 'history-dialog') historyRequest += 1;
      if (dialog.id === 'estimate-dialog') estimateDraft = null;
      if (dialog.id === 'completion-dialog') completionDraft = null;
      if (dialog.contains($('toast'))) {
        $('toast').hidden = true;
        $('toast').classList.remove('toast-in-dialog');
        document.body.append($('toast'));
      }
      const opener = dialogOpeners.get(dialog.id);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
  });
  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty) flushAutosave().catch(() => {}); });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', async () => {
      try {
        await navigator.serviceWorker.register(new URL('./sw.js', document.baseURI), { scope: './' });
        await navigator.serviceWorker.ready;
        $('offline-status').textContent = '页面和任务库已支持离线使用。收藏这个网址，或通过浏览器菜单安装到桌面，以后直接打开即可。';
      } catch {
        $('offline-status').textContent = '把这个网址收藏起来，之后联网打开就能继续打卡。';
      }
    });
  }
  load();
})();
