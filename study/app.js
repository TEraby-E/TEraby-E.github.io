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
  let completionDraft = null;
  let planEditing = null;
  let planCatalogue = null;
  const planPages = new Map();
  const planChapterFilters = new Map();
  const PLAN_PAGE_SIZE = 12;
  let planEditBaseline = null;
  let planDraggedTask = null;
  let cloudAccount = null;
  let cloudRefreshRevision = 0;
  let refreshing = false;
  let accountChanging = false;
  let accountReloading = false;
  const dialogOpeners = new Map();
  const expandedSubjects = new Set();
  const recordStore = () => cloudAccount?.store || window.StudyStore;

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

  async function api(path, options = {}) {
    if (!window.StudyStore) throw new ApiError('记录模块没有载入，请刷新页面后重试。', 0);
    return recordStore().request(path, options);
  }

  function normaliseState(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Array.isArray(value.assignments)) {
      throw new Error('学习记录的格式不正确，请重新载入。');
    }
    return { ...value, history: Array.isArray(value.history) ? value.history : [], completed_ids: Array.isArray(value.completed_ids) ? value.completed_ids : [], library_completed_ids: Array.isArray(value.library_completed_ids) ? value.library_completed_ids : [], library_reopened_ids: Array.isArray(value.library_reopened_ids) ? value.library_reopened_ids : [], task_modes: value.task_modes || {}, subject_phases: value.subject_phases || {}, plan_tasks: Array.isArray(value.plan_tasks) ? value.plan_tasks : [], task_progress: value.task_progress || {}, assignments: value.assignments.map((assignment) => ({ ...assignment, done: Boolean(assignment.done) })) };
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
      this.modeOf = taskMode;
      this.subjectProgress = new Map();
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
    const chapterTitle = String(assignment.section_name || canonicalTask(assignment)?.section_name || assignment.chapter_title || catalogue().chapters.get(assignment.chapter_id)?.title || '').trim();
    if (!chapterTitle || String(assignment.title || '').includes(chapterTitle)) return '';
    return `<span class="${className}">${escape(chapterTitle)}</span>`;
  }

  function canonicalTask(task) {
    const id = task.task_id || task.id;
    const entry = catalogue().tasks.get(id);
    if (entry && (!task.subject_id || task.subject_id === entry.subject.id)) return entry.task;
    return retiredTasks.get(id) || null;
  }

  function actualSummary(tasks) {
    return window.StudyTime.summarizeActual(tasks);
  }

  function formattedTime(minutes) {
    return window.StudyTime?.formatMinutes(minutes) || `${minutes}分钟`;
  }

  function actualSummaryText(tasks) {
    const summary = actualSummary(tasks);
    if (!summary.actualKnown && summary.actualUnknown) return `实际用时待补记 · ${summary.actualUnknown}项未记录`;
    return `实际 ${formattedTime(summary.actualMinutes || 0)}${summary.actualUnknown ? ` · 另${summary.actualUnknown}项未记录` : ''}`;
  }

  function completionKey(task) {
    return task.estimate_group || canonicalTask(task)?.estimate_group || task.task_id;
  }

  function expandedCompletionTasks(tasks, mode = 'complete') {
    const keys = new Set(tasks.map(completionKey));
    return state.assignments.filter((task) => keys.has(completionKey(task)) && (mode !== 'edit' || task.done));
  }

  function completionInitial(rows, multi) {
    return window.StudyModels.defaultActualInput(rows.map(task => ({ ...task, estimated_minutes: Object.hasOwn(task, 'estimated_minutes') ? task.estimated_minutes : canonicalTask(task)?.estimated_minutes })), { useRecorded: !multi });
  }

  function openCompletion(taskIds, mode = 'complete') {
    if (!state || actionBusy) return;
    const requested = state.assignments.filter(task => taskIds.includes(task.task_id) && (mode === 'status' || (taskMode(task) === 'multi-day' ? !new LearningTask(task).completed : mode === 'edit' ? task.done : !task.done)));
    if (!requested.length) return;
    const tasks = expandedCompletionTasks(requested, mode);
    const groups = new Map();
    tasks.forEach((task) => {
      const key = completionKey(task);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    });
    const entries = [...groups.values()].map(rows => ({ taskIds: rows.map(task => task.task_id), rows, multi: taskMode(rows[0]) === 'multi-day', statusOnly: mode === 'status' }));
    completionDraft = { date: state.date, version: changeVersion, mode, entries };
    $('completion-title').textContent = mode === 'status' ? '多日任务打卡记录' : entries.some(entry => entry.multi) ? '记录本次学习片段' : mode === 'edit' ? '记录实际用时' : '完成任务，记下实际用时';
    $('completion-description').textContent = entries.some(entry => entry.multi) ? '多日任务每次用时累加到当天；只有勾选“标记完成”才结束整项任务。' : mode === 'edit' ? '可修改已记录的实际用时。' : '填写本次实际用时后保存打卡。';
    $('completion-fields').innerHTML = entries.map(({ rows, multi, statusOnly }, index) => {
      const task = rows[0];
      const initial = completionInitial(rows, multi);
      const subjects = [...new Set(rows.map((item) => subjectName(item) || subjectName(library.find((subject) => subject.id === item.subject_id) || {})))].filter(Boolean);
      const segments = window.StudyModels.segmentsOf(task);
      const history = multi && segments.length ? `<p class="segment-summary">今日已记录 ${segments.length} 段 · 累计 ${escape(formattedTime(task.actual_minutes))}</p><ol class="segment-list">${segments.map((minutes, i) => `<li>第${i + 1}段 · ${escape(formattedTime(minutes))}</li>`).join('')}</ol><button type="button" class="text-button undo-segment" data-undo-segment="${escape(task.task_id)}">撤销最后一段</button>` : '';
      const finish = multi ? `<label class="finish-multiday"><input type="checkbox" data-completion-finish="${index}" ${new LearningTask(task).completed ? 'checked' : ''}><span><strong>标记完成</strong><small>勾选后结束整项多日任务；未勾选可继续分段打卡。</small></span></label>` : '';
      const input = statusOnly ? '' : `<label class="completion-input-label" for="actual-minutes-${index}">${multi ? '本次实际用时' : '实际用时'}<span class="completion-input-row"><input id="actual-minutes-${index}" data-completion-index="${index}" type="number" min="0" max="525600" step="any" inputmode="decimal" required placeholder="填写实际分钟" value="${initial}" aria-describedby="completion-help completion-error"><span>分钟</span></span></label>`;
      return `<section class="completion-entry ${multi ? 'is-multiday' : ''}"><div class="completion-entry-copy"><h3>${escape(task.title)}</h3><p>${escape(subjects.join(' · '))}${rows.length > 1 ? ` · ${rows.length} 个共享条目，只计一次` : ''}</p>${history}</div>${input}${finish}</section>`;
    }).join('');
    $('completion-error').hidden = true;
    $('save-completion').textContent = mode === 'status' ? '保存完成状态' : mode === 'edit' ? '保存实际用时' : '保存本次打卡';
    openDialog('completion-dialog');
    [...$('completion-fields').querySelectorAll('input[data-completion-index]')].forEach((input, index) => {
      const entry = entries[Number(input.dataset.completionIndex)];
      const rows = entry.rows;
      const initial = completionInitial(rows, entry.multi);
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
    const values = inputs.map(input => ({ input, index: Number(input.dataset.completionIndex), raw: input.value.trim(), minutes: Number(input.value) }));
    const invalid = values.find(({ input, raw, minutes }) => raw === '' || input.validity?.badInput || !Number.isFinite(minutes) || minutes < 0 || minutes > 525600);
    if (invalid || values.length !== draft.entries.filter(entry => !entry.statusOnly).length) {
      $('completion-error').textContent = '请为每项任务填写 0 至 525600 的实际分钟数，支持小数；没有耗时可填 0。';
      $('completion-error').hidden = false;
      invalid?.input.focus();
      return;
    }
    try {
      draft.entries.forEach((entry, index) => {
        if (entry.multi && !entry.statusOnly) window.StudyModels.appendSegment(entry.rows[0], values.find(value => value.index === index).minutes);
      });
    } catch (error) { $('completion-error').textContent = error.message; $('completion-error').hidden = false; return; }
    draft.entries.forEach((entry, index) => {
      const task = state.assignments.find(item => item.task_id === entry.taskIds[0]);
      const model = new LearningTask(task);
      if (!entry.statusOnly) model.recordCheckin(values.find(value => value.index === index).minutes);
      if (entry.multi) {
        const finish = $('completion-fields').querySelector(`[data-completion-finish="${index}"]`).checked;
        if (finish !== model.completed) model.setCompleted(finish);
      }
    });
    const count = draft.entries.reduce((sum, entry) => sum + entry.taskIds.length, 0);
    const focusId = draft.entries[0].taskIds[0];
    closeDialog('completion-dialog');
    changed();
    [...document.querySelectorAll('#daily-tbody input[data-task]')].find((input) => input.dataset.task === focusId)?.focus({ preventScroll: true });
    try {
      await flushAutosave();
      renderDay();
      showToast(draft.mode === 'status' ? '多日任务完成状态已保存，已记录用时保留。' : draft.mode === 'edit' ? '实际用时已保存。' : `${count} 项任务已打卡，实际用时已保存。`, null, 4500);
    } catch {
      showToast('本次打卡尚未保存，请查看页面提示后重试。', null, 6500);
    }
  }

  function undoCompletion(tasks) {
    tasks.forEach((task) => new LearningTask(task).undoCheckin());
    changed();
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
    $('plan-button').disabled = unavailable;
    $('new-plan-task').disabled = unavailable;
    $('plan-fields').disabled = actionBusy;
    $('manage-plan-button').disabled = unavailable;
    $('export-button').disabled = unavailable;
    $('export-history-button').disabled = actionBusy || !historyRecord;
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
      return window.StudyModels.taskCompleted(this.taskIds, this.mode, currentIndex());
    }

    setCompleted(completed) {
      if (this.children.length) { this.children.forEach(child => child.setCompleted(completed)); return completed; }
      if (this.mode !== 'multi-day') return false;
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
      const rows = this.taskIds.map(id => index.byId.get(id)).filter(Boolean);
      const updates = rows.map(task => this.mode === 'multi-day' ? window.StudyModels.appendSegment(task, minutes) : { done: true, actual_minutes: minutes, ...(task.checkin_segments ? { checkin_segments: [minutes] } : {}) });
      rows.forEach((task, index) => Object.assign(task, updates[index]));
      if (this.mode !== 'multi-day') state.library_reopened_ids = state.library_reopened_ids.filter(id => !this.taskIds.includes(id));
    }

    undoCheckin() {
      const index = currentIndex();
      this.taskIds.forEach((id) => { const task = index.byId.get(id); if (task) { task.done = false; task.actual_minutes = null; if (task.checkin_segments) task.checkin_segments = []; } });
    }

    undoLastCheckin() {
      if (this.mode !== 'multi-day') return;
      const wasCompleted = this.completed;
      this.taskIds.forEach(id => {
        const task = currentIndex().byId.get(id);
        if (!task) return;
        const segments = window.StudyModels.segmentsOf(task);
        segments.pop();
        Object.assign(task, { checkin_segments: segments, done: segments.length > 0, actual_minutes: segments.length ? window.StudyModels.sumSegments(segments) : null });
      });
      if (wasCompleted) this.setCompleted(false);
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
    get learningInfo() {
      if (this.cachedLearningInfo) return this.cachedLearningInfo;
      const subject = library.find(item => item.id === (this.task.subject_id || catalogue().tasks.get(this.id)?.subject.id));
      return this.cachedLearningInfo = window.StudyModels.learningInfo(this.task, subject?.sectionFor?.(this.task));
    }
    get presentation() {
      if (this.cachedPresentation) return this.cachedPresentation;
      const subjectId = this.task.subject_id || catalogue().tasks.get(this.id)?.subject.id;
      const remarks = /〔原图/.test(this.task.remarks || '') ? canonicalTask(this.task)?.remarks || this.task.remarks : this.task.remarks;
      return this.cachedPresentation = new window.StudyModels.TaskPresentation({ ...this.task, ...this.learningInfo, remarks }, null, { showLearningInfo: ['ds', 'co', 'os', 'cn'].includes(subjectId) });
    }

    status() {
      const tags = [this.mode === 'multi-day' ? '<span class="card-status is-multi">持续学习</span>' : '<span class="card-status">待学习</span>'];
      if (this.completed) tags.push('<span class="card-status is-done">已完成</span>');
      else if (this.timeTask.done) tags.push('<span class="card-status is-today">今日已打卡</span>');
      if (this.completed && this.mode !== 'multi-day') tags.shift();
      if (this.mode === 'multi-day' && this.variant === 'daily') tags.push(`<span class="card-progress">累计打卡 ${state.task_progress[this.id]?.checkins || 0} 天</span>`);
      if (this.options.compact && this.mode !== 'multi-day' && !this.completed && !this.timeTask.done) return '';
      return `<div class="card-status-row">${tags.join('')}</div>`;
    }

    title() {
      const chapter = this.options.chapter ? chapterLine(this.task, 'card-eyebrow') : '';
      return `<span class="card-titleblock">${chapter}<span class="card-title">${escape(this.presentation.title)}</span></span>`;
    }

    heading() { return `<div class="card-heading">${this.title()}</div>`; }

    content() {
      const task = this.task;
      const presentation = this.presentation;
      const detailText = presentation.detail;
      const detail = detailText ? `<p class="card-detail">${escape(detailText)}</p>` : '';
      const metadata = presentation.metadata.map(([label, value]) => `${label}：${value}`);
      const tags = metadata.length ? `<div class="card-metadata">${metadata.map((text) => `<span>${escape(text)}</span>`).join('')}</div>` : '';
      const remarks = presentation.remarks;
      const notes = remarks ? `<details class="card-notes" open><summary>学习备注${icon('chevron')}</summary><p>${escape(remarks)}</p></details>` : '';
      return detail || tags || notes ? `<div class="card-content">${detail}${tags}${notes}</div>` : '';
    }

    controls() { return ''; }
    footer() { const controls = this.controls(); return controls ? `<div class="card-footer">${controls}</div>` : ''; }

    exportSnapshot() {
      const progress = state.task_progress[this.id];
      return {
        ...this.task,
        ...this.learningInfo,
        remarks: /〔原图/.test(this.task.remarks || '') ? canonicalTask(this.task)?.remarks || this.task.remarks : this.task.remarks,
        task_mode: this.mode,
        overall_completed: this.completed,
        checkin_days: progress?.checkins || 0,
        total_actual_minutes: progress?.actual_minutes || 0,
        export_context: this.variant,
      };
    }

    render() {
      const tag = this.variant === 'daily' ? 'li' : 'article';
      const classes = ['study-card', `${this.variant}-card`, this.options.compact ? 'is-compact' : '', this.completed ? 'is-finished' : '', this.options.selected ? 'is-selected' : '', this.timeTask.done ? 'is-checked-in' : ''].filter(Boolean).join(' ');
      return `<${tag} class="${classes}" data-card-key="${this.variant}:${escape(this.id)}" data-finished="${this.completed}">${this.status()}${this.heading()}${this.content()}${this.footer()}</${tag}>`;
    }
  }

  class DailyTaskCardView extends TaskCardView {
    get variant() { return 'daily'; }

    heading() {
      const task = this.task;
      return `<div class="card-heading"><label class="card-selection"><input id="daily-task-${escape(this.id)}" type="checkbox" data-task="${escape(this.id)}" ${task.done ? 'checked' : ''} aria-label="${escape(task.title)}，${task.done ? '今日已打卡' : '今日未打卡'}">${this.title()}</label><button type="button" class="card-remove" data-action="remove" data-task="${escape(this.id)}" aria-label="从今日清单移除：${escape(task.title)}" title="移除今日任务">${icon('close')}</button></div>`;
    }

    controls() {
      const label = this.mode === 'multi-day' ? this.completed ? '查看打卡' : this.task.done ? '继续打卡' : '打卡' : this.task.done ? '已打卡' : '打卡';
      return `<div class="card-controls"><button type="button" class="card-checkin-button" data-action="record-actual" data-task="${escape(this.id)}" aria-label="${escape(label)}：${escape(this.task.title)}">${icon('check')}<span class="card-checkin-label">${label}</span></button>${canonicalTask(this.task) ? taskModeControl(this.task) : ''}</div>`;
    }
  }

  class LibraryTaskCardView extends TaskCardView {
    get variant() { return 'library'; }

    heading() {
      return `<div class="card-heading"><label class="card-selection"><input type="checkbox" data-library-task="${escape(this.id)}" ${this.options.selected ? 'checked' : ''} aria-label="选择今日任务：${escape(this.task.title)}">${this.title()}</label></div>`;
    }

    controls() {
      return `<div class="card-controls">${taskModeControl(this.task)}</div>`;
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

  }

  class CardMotion {
    static patch(container, html) {
      if ((container.tagName !== 'TBODY' && container.id !== 'daily-tbody') || !document.createElement) { container.innerHTML = html; return; }
      CardMotion.rowMarkup ||= new WeakMap();
      const incoming = document.createElement(container.tagName === 'TBODY' ? 'tbody' : 'div');
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
      const noteStates = new Map([...(container.querySelectorAll?.('.card-notes') || [])].map((notes) => [notes.closest('[data-card-key]').dataset.cardKey, CardMotion.folds?.get(notes)?.opening ?? notes.open]));
      const previous = new Map((reduced ? [] : [...(container.querySelectorAll?.('[data-card-key]') || [])].filter(card => !card.closest('[hidden]'))).map((card) => [card.dataset.cardKey, { rect: card.getBoundingClientRect(), finished: card.dataset.finished }]));
      CardMotion.patch(container, html);
      (container.querySelectorAll?.('[data-card-key]') || []).forEach((card) => {
        if (noteStates.has(card.dataset.cardKey)) { const notes = card.querySelector('.card-notes'); if (notes) notes.open = noteStates.get(card.dataset.cardKey); }
        if (activeCard && card.dataset.cardKey === activeCard.dataset.cardKey && focusIndex >= 0) {
          const target = card.querySelectorAll('button,input,select,summary')[focusIndex];
          const fold = card.closest('details');
          (fold && !fold.open ? fold.querySelector('summary') : target)?.focus({ preventScroll: true });
        }
      });
      if (reduced || !previous.size) return;
      let entered = 0;
      const viewportHeight = window.innerHeight || Infinity;
      const measured = [...(container.querySelectorAll?.('[data-card-key]') || [])].filter(card => !card.closest('[hidden]')).map((card) => ({ card, rect: card.getBoundingClientRect() }));
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

    static finishSubject(group) {
      const motion = CardMotion.subjectMotions?.get(group);
      if (!motion) return;
      motion.height.onfinish = null;
      motion.height.cancel();
      motion.fade.cancel();
      motion.wrapper.style.overflow = '';
      motion.wrapper.style.overflowAnchor = '';
      motion.wrapper.removeAttribute('data-animating');
      CardMotion.subjectMotions.delete(group);
      CardMotion.activeSubjects.delete(group);
    }

    static finishSubjects() {
      for (const group of CardMotion.activeSubjects || []) CardMotion.finishSubject(group);
    }

    static switchSubject(group, open, materialize) {
      const wrapper = group.querySelector('.subject-transition');
      const body = group.querySelector('.subject-body');
      const summary = group.querySelector('.subject-stage-summary');
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      // Read the current animated height before canceling, so rapid reversal is continuous.
      const start = !reduced && wrapper.animate ? wrapper.getBoundingClientRect().height : 0;
      CardMotion.finishSubject(group);
      if (open && body.dataset.loaded !== 'true') {
        materialize(body);
        body.dataset.loaded = 'true';
      }
      body.hidden = !open;
      if (summary) summary.hidden = open;
      const incoming = open ? body : summary;
      if (reduced || !wrapper.animate || !incoming?.animate || !group.isConnected) return;
      const end = wrapper.getBoundingClientRect().height;
      if (!start && !end) return;
      wrapper.style.overflow = 'hidden';
      wrapper.style.overflowAnchor = 'none';
      wrapper.setAttribute('data-animating', '');
      const options = { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' };
      const height = wrapper.animate([{ height: `${start}px` }, { height: `${end}px` }], options);
      const fade = incoming.animate([{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { ...options, duration: 230 });
      CardMotion.subjectMotions ||= new WeakMap();
      CardMotion.activeSubjects ||= new Set();
      CardMotion.subjectMotions.set(group, { wrapper, height, fade });
      CardMotion.activeSubjects.add(group);
      height.onfinish = () => { if (CardMotion.subjectMotions.get(group)?.height === height) CardMotion.finishSubject(group); };
    }
  }

  function libraryTaskCompleted(taskId) {
    return new LearningTask({ task_id: taskId }).completed;
  }

  function subjectProgress(subject, historyProgress, phase = state.subject_phases[subject.id]) {
    if (historyProgress) return historyProgress;
    const cache = currentIndex().subjectProgress;
    const key = `${subject.id}:${phase ?? '<auto>'}`;
    if (cache.has(key)) return cache.get(key);
    const model = subject instanceof window.StudyModels.StudySubject ? subject : window.StudyModels.createSubject(subject);
    const progress = model.stageProgress({ phase, selectedIds: subjectAssignments(subject.id).map(task => task.task_id), isCompleted: task => new LearningTask(task).completed });
    cache.set(key, progress);
    return progress;
  }

  function taskCardsMarkup(tasks, CardView = DailyTaskCardView) {
    return tasks.length ? `<ul class="task-list">${tasks.map(task => new CardView(task, { compact: true, chapter: true }).render()).join('')}</ul>` : '';
  }

  function stageProgressMarkup(subject, progress) {
    const percent = progress.percent;
    const label = percent === null ? '暂无用时数据' : percent > 0 && percent < 0.1 ? '<0.1%' : `${Math.min(percent < 100 ? 99.9 : 100, Math.round(percent * 10) / 10)}%`;
    const bar = percent === null ? '' : `<div class="subject-stage-track" role="progressbar" aria-label="${escape(subjectName(subject))}阶段进度${progress.unknown ? '（按已知用时）' : ''}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${escape(label)}"><span style="width:${percent}%"></span></div>`;
    return `<div class="subject-stage-line"><span class="subject-phase">${escape(progress.phase || '全部阶段')}</span><strong class="subject-stage-value">${escape(label)}</strong></div>${bar}`;
  }

  function progressSummary(subject, tasks, progress, open) {
    if (!tasks.length) return '';
    return `<div class="subject-stage-summary" ${open ? 'hidden' : ''}>${stageProgressMarkup(subject, progress)}<span class="subject-daily-time">今日${escape(actualSummaryText(tasks))}</span></div>`;
  }

  function subjectGroupsMarkup(assignments, { history = false, stageProgress = null } = {}) {
    const CardView = history ? HistoryTaskCardView : DailyTaskCardView;
    return library.map((subject) => {
      const tasks = subjectAssignments(subject.id, assignments);
      const allDone = tasks.length && tasks.every(task => task.done);
      const open = !history && expandedSubjects.has(subject.id);
      // One subject fold contains all cards, without another completed-card frame.
      const taskContent = open ? taskCardsMarkup(tasks, CardView) : '';
      const summary = tasks.length ? progressSummary(subject, tasks, subjectProgress(subject, stageProgress?.[subject.id]), open) : '';
      return `<section role="listitem" aria-labelledby="subject-name-${escape(subject.id)}" data-subject-row="${escape(subject.id)}" data-record-version="${state.revision}:${changeVersion}" class="subject-group ${tasks.length ? 'has-tasks' : 'is-empty'} ${allDone ? 'is-complete' : ''}">
        <div class="subject-heading"><h3><button type="button" class="subject-button" data-action="choose" aria-haspopup="dialog" aria-controls="library-dialog" data-subject="${escape(subject.id)}" aria-label="选择${escape(subjectName(subject))}的章节任务"><strong class="subject-name" id="subject-name-${escape(subject.id)}">${escape(subjectName(subject))}</strong></button></h3><button type="button" class="subject-toggle" data-action="toggle-subject" data-subject="${escape(subject.id)}" aria-controls="subject-body-${escape(subject.id)}" aria-expanded="${open}" aria-label="${open ? '收起' : '展开'}${escape(subjectName(subject))}任务">${icon('chevron', 'subject-chevron')}</button></div>
        <div class="subject-transition">${summary}<div class="subject-body" id="subject-body-${escape(subject.id)}" data-loaded="${open}" ${open ? '' : 'hidden'}>${taskContent}</div></div>
      </section>`;
    }).join('');
  }

  function toggleSubject(subjectId) {
    if (expandedSubjects.has(subjectId)) expandedSubjects.delete(subjectId);
    else expandedSubjects.add(subjectId);
    const group = [...document.querySelectorAll('[data-subject-row]')].find(row => row.dataset.subjectRow === subjectId);
    if (!group) return;
    const open = expandedSubjects.has(subjectId);
    const button = group.querySelector('.subject-toggle');
    CardMotion.switchSubject(group, open, body => { body.innerHTML = taskCardsMarkup(subjectAssignments(subjectId)); });
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', `${open ? '收起' : '展开'}${subjectName(library.find(subject => subject.id === subjectId))}任务`);
  }

  function renderDay() {
    if (!state) return;
    CardMotion.finishSubjects();
    const { value } = dateParts(state.date);
    $('study-date').textContent = readableDate(state.date);
    $('study-date').dateTime = state.date;
    $('study-weekday').textContent = value.toLocaleDateString('zh-CN', { weekday: 'long' });
    const total = state.assignments.length;
    $('task-total').textContent = `${total} 项`;
    const duration = actualSummary(state.assignments);
    $('actual-time').textContent = !duration.actualKnown && duration.actualUnknown ? '待补记' : formattedTime(duration.actualMinutes || 0);
    CardMotion.update($('daily-tbody'), subjectGroupsMarkup(state.assignments));
    renderDayProgress($, state.assignments);
    updateControls();
  }

  function renderDayProgress(find, assignments) {
    const total = assignments.length;
    const completed = assignments.filter(task => task.done).length;
    find('completion-text').textContent = total ? `${completed} / ${total} 项` : '';
    find('completion-text').hidden = !total;
    const progress = total ? completed / total * 100 : 0;
    find('summary-progress-fill').style.width = `${progress}%`;
    find('completion-rate').textContent = `${Math.round(progress)}%`;
    find('summary-progress').setAttribute('aria-valuemax', String(total || 1));
    find('summary-progress').setAttribute('aria-valuenow', String(completed));
    find('summary-progress').setAttribute('aria-valuetext', total ? `已完成 ${completed} / ${total} 项任务` : '今天还未安排任务');
  }

  function imageSurface(record, isCurrent) {
    CardMotion.finishSubjects();
    const surface = document.createElement('div');
    surface.className = 'page-shell export-surface';
    surface.style.width = `${Math.ceil($('task-sheet').getBoundingClientRect().width) + 32}px`;
    surface.append(document.querySelector('.page-heading').cloneNode(true), $('task-sheet').cloneNode(true));
    const emblem = document.createElement('img');
    emblem.className = 'export-emblem';
    emblem.src = new URL('./assets/terabyte-flow.svg', document.baseURI).href;
    emblem.alt = 'Terabyte 标志';
    emblem.width = emblem.height = 76;
    surface.querySelector('.page-heading').append(emblem);
    const find = id => surface.querySelector(`[id="${id}"]`);
    find('task-sheet').setAttribute('aria-busy', 'false');
    find('save-status-text').textContent = '已保存';
    if (!isCurrent) {
      const { value } = dateParts(record.date);
      find('study-date').textContent = readableDate(record.date);
      find('study-date').dateTime = record.date;
      find('study-weekday').textContent = value.toLocaleDateString('zh-CN', { weekday: 'long' });
      const duration = actualSummary(record.assignments);
      find('actual-time').textContent = !duration.actualKnown && duration.actualUnknown ? '待补记' : formattedTime(duration.actualMinutes || 0);
      find('sheet-title').textContent = '当天的任务';
      find('task-total').textContent = `${record.assignments.length} 项`;
      find('daily-tbody').innerHTML = subjectGroupsMarkup(record.assignments, { history: true, stageProgress: record.subject_stage_progress });
      renderDayProgress(find, record.assignments);
    }
    return surface;
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
    planCatalogue = await api('/api/library');
    dirty = false;
    changeVersion += 1;
    closeDialog('library-dialog');
    closeDialog('completion-dialog');
    completionDraft = null;
    renderDay();
    if ($('plan-dialog').open) renderPlans();
    setStatus('saved', '已同步最新记录');
    showError('另一个窗口或设备更新了学习记录。页面已载入最新内容，请重新操作。');
    showToast('已载入最新记录，请重新操作。');
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
        refreshCloudIfIdle();
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
    const phase = subject.resolvePhase(state.subject_phases[id], task => libraryTaskCompleted(task.id), [...selected]);
    subjectDraft = { subject, selected, chapterId: firstSelected?.id || nextChapter?.id || subject.chapters[0]?.id, query: '', phase };
    $('library-title').textContent = `${subjectName(subject)} · 选择学习任务`;
    $('library-search').value = '';
    $('library-phase').innerHTML = '<option value="">全部阶段</option>' + [...new Set(subject.chapters.map((chapter) => chapter.phase).filter(Boolean))].map((phase) => `<option value="${escape(phase)}">${escape(phase)}</option>`).join('');
    $('library-phase').value = phase;
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
    $('selection-summary').innerHTML = `已选 <strong>${size}</strong> 项任务`;
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
      return `<button type="button" class="chapter-button" data-chapter="${escape(chapter.id)}" aria-current="${chapter.id === subjectDraft.chapterId}"><span>${escape(chapter.title)}</span>${chosen ? `<span class="chapter-selected" aria-label="已选 ${chosen} 项">${chosen}</span>` : ''}</button>`;
    }).join('');
    $('chapter-list').innerHTML = chapters.length ? subject.renderGroups(renderChapters, { key: groupKey, open, title: '已完成章节' }) : '<div class="empty-state"><p>没有匹配的章节</p></div>';
  }

  function renderLibraryContent() {
    const chapter = subjectDraft.subject.chapters.find((item) => item.id === subjectDraft.chapterId);
    if (!chapter) {
      $('chapter-content').innerHTML = `<div class="empty-state">${icon('search')}<strong>${subjectDraft.query ? '没有找到匹配的任务' : '这个科目还没有章节任务'}</strong></div>`;
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
    const taskCards = (entries) => `<div class="library-tasks">${entries.map((task) => new LibraryTaskCardView(task, { compact: true, assignment: today.get(task.id), selected: subjectDraft.selected.has(task.id) }).render()).join('')}</div>`;
    CardMotion.update($('chapter-content'), `<div class="chapter-heading"><div><h3>${escape(chapter.title)}</h3></div>${pending.length ? `<button class="text-button" id="toggle-chapter" type="button">${allChosen ? '取消未完成全选' : '全选未完成'}</button>` : ''}</div>${visible.renderGroups((nodes) => taskCards(nodes.map((node) => node.data)), { key: groupKey, open: expanded })}`);
  }

  function renderLibrary() {
    window.clearTimeout(searchTimer);
    const chapters = filteredChapters();
    if (!chapters.some((chapter) => chapter.id === subjectDraft.chapterId)) subjectDraft.chapterId = chapters[0]?.id;
    renderLibraryNavigation();
    renderLibraryContent();
    updateSelectionSummary();
    renderLibraryProgress();
  }

  function renderLibraryProgress() {
    const subject = subjectDraft.subject;
    const markup = stageProgressMarkup(subject, subjectProgress(subject, null, subjectDraft.phase));
    const target = $('library-stage-summary');
    if (target.innerHTML !== markup) target.innerHTML = markup;
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
        replacement.push({ ...(existing.get(task.id) || { task_id: task.id, subject_id: id, chapter_id: chapter.id, title: task.title, detail: task.detail || '', done: false }), subject_name: subjectDraft.subject.name, chapter_title: chapter.title, task_mode: taskMode(task), estimate_group: task.estimate_group || null });
      }
    }));
    state.assignments = state.assignments.filter((assignment) => assignment.subject_id !== id).concat(replacement, preserved);
    closeDialog('library-dialog');
    changed();
    [...document.querySelectorAll('.subject-button')].find((element) => element.dataset.subject === id)?.focus({ preventScroll: true });
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
      $('history-content').innerHTML = `<div class="history-detail-heading"><h3>${escape(readableDate(date))}</h3><span>完成 ${completed} / ${assignments.length} 项任务<small class="history-time-line">${escape(actualSummaryText(assignments))}</small></span></div>${assignments.length ? library.map((subject) => {
        const tasks = subjectAssignments(subject.id, assignments);
        if (!tasks.length) return '';
        return `<section class="history-subject"><h4 class="subject-name">${escape(subjectName(subject))}</h4>${tasks.map((task) => new HistoryTaskCardView(task, { compact: true, chapter: true }).render()).join('')}</section>`;
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
      $('history-content').innerHTML = `<div class="empty-state">${icon('book')}<strong>还没有保存过的学习记录</strong><p>有打卡的日期会在换日后自动出现在这里。</p></div>`;
      $('export-history-button').hidden = true;
    }
  }

  function setBusy(busy, action = '') {
    actionBusy = busy;
    updateControls();
    $('export-button').innerHTML = `${busy && action === 'export' ? '<span class="loading-spinner" aria-hidden="true"></span>' : icon('image')}<span>${busy && action === 'export' ? '正在导出' : '导出今日图片'}</span>`;
    if (!busy) refreshCloudIfIdle();
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
      record.surface = imageSurface(record, isCurrent);
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

  function renderPlans() {
    const query = $('plan-search').value.trim().toLowerCase();
    const subjectId = $('plan-filter').value;
    const entries = window.StudyStore.plan.entries(planCatalogue);
    const subjects = planCatalogue.subjects.filter(subject => !subjectId || subject.id === subjectId);
    const planned = new Set(state.assignments.map(task => task.task_id));
    const editing = !$('plan-editor-panel').hidden;
    let visibleCount = 0;
    $('plan-list').innerHTML = subjects.map(subject => {
      const chapterId = planChapterFilters.get(subject.id) || '';
      const tasks = entries.filter(task => task.subject_id === subject.id && (!chapterId || task.chapter_id === chapterId) &&
        `${task.title} ${task.detail} ${task.chapter_title}`.toLowerCase().includes(query));
      visibleCount += tasks.length;
      const pageCount = Math.max(1, Math.ceil(tasks.length / PLAN_PAGE_SIZE));
      const page = Math.max(0, Math.min(planPages.get(subject.id) || 0, pageCount - 1));
      planPages.set(subject.id, page);
      const cards = tasks.slice(page * PLAN_PAGE_SIZE, (page + 1) * PLAN_PAGE_SIZE).map(task => {
        const added = planned.has(task.task_id);
        return `<article class="plan-card ${planEditing === task.task_id ? 'is-editing' : ''}" data-plan-task="${escape(task.task_id)}" draggable="${!editing && !actionBusy}">
          <button type="button" class="plan-card-title" data-plan-action="edit">${escape(task.title)}</button>
          <span class="plan-card-chapter">${escape(task.chapter_title)}</span>
          ${task.detail ? `<p class="plan-card-detail">${escape(task.detail)}</p>` : ''}
          <div class="plan-actions"><button class="text-button" type="button" data-plan-action="add" ${added ? 'disabled' : ''}>${added ? '已在今日清单' : '加入今天'}</button><button class="text-button" type="button" data-plan-action="edit">编辑</button><button class="text-button" type="button" data-plan-action="remove">删除</button></div>
        </article>`;
      }).join('');
      const options = subject.chapters.map(chapter => `<option value="${escape(chapter.id)}" ${chapter.id === chapterId ? 'selected' : ''}>${escape(chapter.title)}</option>`).join('');
      return `<section class="plan-column" data-board-subject="${escape(subject.id)}" aria-labelledby="plan-column-${escape(subject.id)}">
        <div class="plan-column-heading"><h3 id="plan-column-${escape(subject.id)}">${escape(subject.name)}</h3><span>${tasks.length}</span><button type="button" class="plan-column-new" data-board-action="new" aria-label="新建${escape(subject.name)}任务">＋</button></div>
        <select class="plan-column-chapter" data-board-chapter="${escape(subject.id)}" aria-label="筛选${escape(subject.name)}章节"><option value="">全部章节</option>${options}</select>
        <div class="plan-column-cards">${cards || '<p class="plan-board-empty">暂无匹配任务</p>'}</div>
        <div class="plan-column-pagination"><button type="button" class="text-button" data-board-action="previous" ${page === 0 ? 'disabled' : ''}>上一页</button><span>${page + 1} / ${pageCount}</span><button type="button" class="text-button" data-board-action="next" ${page + 1 === pageCount ? 'disabled' : ''}>下一页</button></div>
      </section>`;
    }).join('');
    $('plan-page-label').textContent = `${subjects.length} 个学科 · ${visibleCount} 项任务`;
  }

  function planChapterOptions(selected = '') {
    const subject = planCatalogue.subjects.find(item => item.id === $('plan-subject').value);
    $('plan-chapter').innerHTML = '<option value="">我的任务</option>' + subject.chapters.map(chapter => `<option value="${escape(chapter.id)}">${escape(chapter.title)}</option>`).join('');
    $('plan-chapter').value = selected;
  }

  function planTaskFingerprint(task) {
    return JSON.stringify([task.title, task.detail || '', task.subject_id, task.chapter_id, task.estimated_minutes ?? null]);
  }

  function editPlanTask(task = null, subjectId = '', chapterId = '') {
    planEditing = task?.task_id || null;
    planEditBaseline = task ? planTaskFingerprint(task) : null;
    $('plan-task-title').value = task?.title || '';
    $('plan-detail').value = task?.detail || '';
    $('plan-estimated').value = task?.estimated_minutes ?? '';
    $('plan-subject').value = task?.subject_id || subjectId || planCatalogue.subjects[0].id;
    planChapterOptions(task?.chapter_id || chapterId);
    $('plan-editor-title').textContent = task ? '编辑任务' : '新建任务';
    $('plan-editor-panel').hidden = false;
    $('plan-message').textContent = '';
    renderPlans();
    $('plan-task-title').focus({ preventScroll: true });
  }

  function closePlanEditor() {
    planEditing = null;
    planEditBaseline = null;
    $('plan-editor-panel').hidden = true;
    renderPlans();
  }

  function openPlans() {
    if (!state || actionBusy) return;
    $('plan-subject').innerHTML = library.map(subject => `<option value="${escape(subject.id)}">${escape(subjectName(subject))}</option>`).join('');
    $('plan-filter').innerHTML = '<option value="">全部学科</option>' + $('plan-subject').innerHTML;
    planPages.clear();
    planChapterFilters.clear();
    $('plan-search').value = '';
    $('plan-message').textContent = '';
    closePlanEditor();
    openDialog('plan-dialog');
  }

  async function savePlan(catalogue, message) {
    setBusy(true);
    try {
      await flushAutosave();
      state = normaliseState(await api('/api/plan', { method: 'PUT', body: JSON.stringify({ date: state.date, revision: state.revision, catalogue }) }));
      dirty = false;
      changeVersion += 1;
      closeDialog('library-dialog');
      planCatalogue = await api('/api/library');
      renderPlans();
    } catch (error) {
      if (error.status === 409) await recoverConflict().catch(() => {});
      throw error;
    } finally { setBusy(false); }
    await load();
    showToast(message);
  }

  function planError(error) {
    if ($('plan-dialog').open) $('plan-message').textContent = error.message;
    else showToast(error.message);
  }

  function newPlanTask(subject_id, title, detail) {
    return { task_id: `custom-${crypto.randomUUID()}`, subject_id, title, detail };
  }

  function downloadBackup(value, filename = `学习记录备份_${state.date}_${Date.now()}.json`) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
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
      if (cloudAccount?.user) await cloudAccount.migrateLocal();
      const [libraryResult, stateResult] = await Promise.all([api('/api/library'), api('/api/state')]);
      if (!canApply()) return;
      if (!Array.isArray(libraryResult.subjects)) throw new Error('章节任务库的格式不正确。');
      if (!preparedCatalogues.has(libraryResult)) preparedCatalogues.set(libraryResult, { subjects: SUBJECT_NAMES.map((name) => libraryResult.subjects.find((subject) => subject.name === name)).filter(Boolean).map((subject) => window.StudyModels.createSubject(subject)), retired: new Map((libraryResult.metadata?.retired_tasks || []).map((task) => [task.id, task])) });
      const prepared = preparedCatalogues.get(libraryResult);
      const freshLibrary = prepared.subjects;
      const freshRetired = prepared.retired;
      if (freshLibrary.length !== SUBJECT_NAMES.length) throw new Error('章节任务库缺少科目，请重新载入任务库。');
      const fresh = normaliseState(stateResult);
      if (state && fresh.revision < state.revision) return;
      const externalUpdate = state && fresh.revision !== state.revision;
      if (externalUpdate) {
        const choosing = $('library-dialog').open;
        const recordingCompletion = $('completion-dialog').open;
        closeDialog('library-dialog');
        closeDialog('completion-dialog');
        subjectDraft = null;
        completionDraft = null;
        if (choosing) showToast('另一页面更新了学习记录，请按最新进度重新选择任务。', null, 6500);
        else if (recordingCompletion) showToast('另一页面更新了学习记录，请按最新清单重新打卡。', null, 6500);
      }
      planCatalogue = libraryResult;
      library = freshLibrary;
      retiredTasks = freshRetired;
      state = fresh;
      dirty = false;
      renderDay();
      setStatus('saved', '已自动保存');
      if ($('plan-dialog').open) renderPlans();
      if (externalUpdate && $('history-dialog').open) openHistory();
    } catch (error) {
      if (!canApply()) return;
      setStatus('error', '载入未完成');
      if (!state) $('daily-tbody').innerHTML = `<div class="empty-state">${icon('book')}<strong>学习清单暂时没有载入</strong><p>请检查网络及存储配置，再点上方“重试”。</p></div>`;
      showError(error.message, load);
      $('task-sheet').setAttribute('aria-busy', 'false');
    } finally {
      if (request === loadRequest && state) {
        updateControls();
        if (!dirty && !savePromise && !actionBusy && $('save-status').dataset.status === 'saving') setStatus('saved', '已自动保存');
      }
    }
  }

  function refreshCloudIfIdle() {
    if (accountReloading || dirty || savePromise || actionBusy || refreshing || !cloudRefreshRevision) return;
    const revision = cloudRefreshRevision;
    cloudRefreshRevision = 0;
    if (!state || revision > state.revision) {
      refreshing = true;
      load().finally(() => {
        refreshing = false;
        refreshCloudIfIdle();
      });
    }
  }

  function queueCloudRefresh(revision) {
    cloudRefreshRevision = Math.max(cloudRefreshRevision, Number.isSafeInteger(revision) ? revision : Infinity);
    refreshCloudIfIdle();
  }

  function reloadAccount() {
    accountReloading = true;
    if (cloudAccount?.user) document.body.hidden = true;
    window.location.reload();
  }

  async function changeAccount(action) {
    if (!cloudAccount || actionBusy || accountReloading) return;
    accountChanging = true;
    setBusy(true);
    $('cloud-form').querySelectorAll('input, button').forEach((element) => { element.disabled = true; });
    $('cloud-sign-out').disabled = true;
    $('cloud-message').textContent = '';
    try {
      await flushAutosave();
      await action();
      reloadAccount();
    } catch (error) {
      $('cloud-message').textContent = error.message;
    } finally {
      $('cloud-password').value = '';
      accountChanging = false;
      if (!accountReloading) {
        $('cloud-form').querySelectorAll('input, button').forEach((element) => { element.disabled = false; });
        $('cloud-sign-out').disabled = false;
        setBusy(false);
      }
    }
  }

  async function start() {
    if (!window.StudyCloud?.configured) {
      cloudAccount = { store: window.StudyStore.createStore(window, null, ':guest') };
      return load();
    }
    try {
      cloudAccount = await window.StudyCloud.connect();
    } catch (error) {
      showError(error.message, start);
      setStatus('error', '登录状态载入未完成');
      $('daily-tbody').textContent = '请检查同步设置后重试。';
      $('task-sheet').setAttribute('aria-busy', 'false');
      return;
    }

    const { user } = cloudAccount;
    $('cloud-button').hidden = false;
    $('cloud-button-text').textContent = user ? '云端同步' : '登录同步';
    $('cloud-status').textContent = user ? '云端记录 · 正在载入' : '访客手账 · 仅保存在此浏览器';
    $('cloud-account-name').textContent = cloudAccount.accountName || '';
    $('cloud-form').hidden = Boolean(user);
    $('cloud-signed-in').hidden = !user;
    if (user) $('offline-status').textContent = '页面可以安装到桌面，云端记录需要联网读写。';
    cloudAccount.onAccountChange(async () => {
      if (accountChanging || accountReloading) return;
      if (!user) {
        // Let an in-flight local save finish before switching to the account.
        try { await flushAutosave(); } catch { return; }
      }
      if (!accountChanging && !accountReloading) reloadAccount();
    });
    await load();
    if (user && !accountReloading) {
      cloudAccount.sync().then(() => queueCloudRefresh()).catch(() => {});
      cloudAccount.watch(queueCloudRefresh);
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
    else if (action === 'toggle-subject') toggleSubject(subjectId);
    else if (action === 'record-actual') {
      const task = state.assignments.find((item) => item.task_id === taskId);
      if (task) openCompletion([taskId], taskMode(task) === 'multi-day' ? new LearningTask(task).completed ? 'status' : 'segment' : task.done ? 'edit' : 'complete');
    }
    else if (action === 'remove') {
      const removedSubject = state.assignments.find((assignment) => assignment.task_id === taskId)?.subject_id;
      state.assignments = state.assignments.filter((assignment) => assignment.task_id !== taskId);
      changed();
      [...document.querySelectorAll('.subject-button')].find((element) => element.dataset.subject === removedSubject)?.focus({ preventScroll: true });
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
    if (!event.target.closest('#toggle-chapter') || !subjectDraft) return;
    const chapter = subjectDraft.subject.chapters.find((item) => item.id === subjectDraft.chapterId);
    const tasks = visibleTasks(chapter).filter((task) => !libraryTaskCompleted(task.id));
    const allChosen = tasks.every((task) => subjectDraft.selected.has(task.id));
    tasks.forEach((task) => allChosen ? subjectDraft.selected.delete(task.id) : subjectDraft.selected.add(task.id));
    renderLibrary();
    $('toggle-chapter')?.focus({ preventScroll: true });
  });

  $('apply-library').addEventListener('click', applyLibrary);
  $('plan-button').addEventListener('click', openPlans);
  $('plan-search').addEventListener('input', () => { planPages.clear(); renderPlans(); });
  $('plan-filter').addEventListener('change', () => { planPages.clear(); renderPlans(); });
  $('plan-subject').addEventListener('change', () => planChapterOptions());
  $('new-plan-task').addEventListener('click', () => { if (!actionBusy) editPlanTask(null, $('plan-filter').value); });
  $('cancel-plan-edit').addEventListener('click', closePlanEditor);
  $('plan-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!state || actionBusy) return;
    $('save-plan-task').disabled = true;
    $('plan-message').textContent = '';
    const task = {
      ...newPlanTask($('plan-subject').value, $('plan-task-title').value, $('plan-detail').value),
      chapter_id: $('plan-chapter').value,
      estimated_minutes: $('plan-estimated').value === '' ? null : $('plan-estimated').valueAsNumber,
    };
    try {
      const original = window.StudyStore.plan.entries(planCatalogue).find(item => item.task_id === planEditing);
      if (planEditing && !original) throw new Error('该任务已删除，请取消编辑。');
      if (original && planTaskFingerprint(original) !== planEditBaseline) throw new Error('该任务已在其他页面更新，请取消编辑后重新打开。');
      if (task.estimated_minutes !== null && (!Number.isFinite(task.estimated_minutes) || task.estimated_minutes < 0 || task.estimated_minutes > 525600)) throw new Error('请填写有效的计划分钟数。');
      const entry = { ...task, task_id: planEditing || task.task_id };
      await savePlan(window.StudyStore.plan.update(planCatalogue, entry), '计划任务已保存。');
      closePlanEditor();
    } catch (error) { planError(error); }
    finally { $('save-plan-task').disabled = false; }
  });
  $('plan-list').addEventListener('click', event => {
    if (!state || actionBusy) return;
    const columnButton = event.target.closest('[data-board-action]');
    if (columnButton) {
      const subjectId = columnButton.closest('[data-board-subject]').dataset.boardSubject;
      const action = columnButton.dataset.boardAction;
      if (action === 'new') editPlanTask(null, subjectId, planChapterFilters.get(subjectId) || '');
      else {
        planPages.set(subjectId, (planPages.get(subjectId) || 0) + (action === 'next' ? 1 : -1));
        renderPlans();
      }
      return;
    }
    const button = event.target.closest('[data-plan-action]');
    if (!button) return;
    const task = window.StudyStore.plan.entries(planCatalogue).find(item => item.task_id === button.closest('[data-plan-task]')?.dataset.planTask);
    if (!task) return;
    $('plan-message').textContent = '';
    const action = button.dataset.planAction;
    if (action === 'edit') {
      editPlanTask(task);
      $('plan-task-title').focus();
    } else if (action === 'remove') {
      if (planEditing === task.task_id) closePlanEditor();
      savePlan(window.StudyStore.plan.remove(planCatalogue, task.task_id), '已从计划删除。').catch(planError);
    } else if (action === 'add' && !state.assignments.some(item => item.task_id === task.task_id)) {
      if (state.assignments.length >= window.StudyStore.MAX_TASKS) { planError(new Error('今日任务已达上限。')); return; }
      const subject = library.find(item => item.id === task.subject_id);
      state.assignments = [...state.assignments, { ...task, subject_name: subject.name, task_mode: taskMode(task), done: false }];
      expandedSubjects.add(task.subject_id);
      changed();
      renderPlans();
      flushAutosave().then(() => showToast('已加入今日清单。')).catch(planError);
    }
  });
  $('plan-list').addEventListener('change', event => {
    const select = event.target.closest('[data-board-chapter]');
    if (!select) return;
    planChapterFilters.set(select.dataset.boardChapter, select.value);
    planPages.set(select.dataset.boardChapter, 0);
    renderPlans();
  });
  $('plan-list').addEventListener('dragstart', event => {
    const card = event.target.closest('[data-plan-task]');
    if (!card || actionBusy || !$('plan-editor-panel').hidden) { event.preventDefault(); return; }
    planDraggedTask = card.dataset.planTask;
    event.dataTransfer.setData('application/x-study-plan-task', planDraggedTask);
    event.dataTransfer.effectAllowed = 'move';
    card.classList.add('is-dragging');
  });
  $('plan-list').addEventListener('dragover', event => {
    const column = event.target.closest('[data-board-subject]');
    if (!column || !planDraggedTask || actionBusy) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    column.classList.add('is-drop-target');
  });
  $('plan-list').addEventListener('dragleave', event => {
    const column = event.target.closest('[data-board-subject]');
    if (column && !column.contains(event.relatedTarget)) column.classList.remove('is-drop-target');
  });
  $('plan-list').addEventListener('dragend', () => {
    planDraggedTask = null;
    $('plan-list').querySelectorAll('.is-dragging,.is-drop-target').forEach(element => element.classList.remove('is-dragging', 'is-drop-target'));
  });
  $('plan-list').addEventListener('drop', event => {
    const column = event.target.closest('[data-board-subject]');
    if (!column || !planDraggedTask || actionBusy) return;
    event.preventDefault();
    column.classList.remove('is-drop-target');
    const task = window.StudyStore.plan.entries(planCatalogue).find(item => item.task_id === planDraggedTask);
    planDraggedTask = null;
    if (!task) return;
    const subjectId = column.dataset.boardSubject;
    const chapterId = planChapterFilters.get(subjectId) || '';
    if (task.subject_id === subjectId && (!chapterId || chapterId === task.chapter_id)) return;
    savePlan(window.StudyStore.plan.update(planCatalogue, { ...task, subject_id: subjectId, chapter_id: chapterId }), '任务已移动。').catch(planError);
  });
  $('download-plan').addEventListener('click', () => {
    if (!state) return;
    downloadBackup(window.StudyStore.plan.pack(planCatalogue), `学习计划_${state.date}.json`);
  });
  $('upload-plan').addEventListener('click', () => $('plan-file').click());
  $('plan-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !state || actionBusy) return;
    $('plan-message').textContent = '';
    try {
      if (file.size > 24 * 1024 * 1024) throw new Error('计划文件超过 24 MB。');
      const incoming = window.StudyStore.plan.unpack(JSON.parse(await file.text()), planCatalogue);
      const catalogue = $('plan-import-mode').value === 'replace' ? incoming : window.StudyStore.plan.merge(planCatalogue, incoming);
      await savePlan(catalogue, '计划已导入。');
    } catch (error) {
      planError(error instanceof SyntaxError ? new Error('计划文件需要是有效的 JSON。') : error);
    }
  });
  $('completion-fields').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-undo-segment]');
    if (!button || !completionDraft || actionBusy || completionDraft.version !== changeVersion) return;
    const id = button.dataset.undoSegment;
    const task = state.assignments.find(item => item.task_id === id);
    if (!task || taskMode(task) !== 'multi-day') return;
    new LearningTask(task).undoLastCheckin();
    closeDialog('completion-dialog');
    changed();
    try { await flushAutosave(); openCompletion([id], 'segment'); showToast('已撤销最后一段，其余学习记录保留。'); }
    catch { showToast('撤销尚未保存，请查看页面提示后重试。'); }
  });
  $('completion-form').addEventListener('submit', (event) => { event.preventDefault(); saveCompletion(); });
  $('manage-plan-button').addEventListener('click', openPlans);
  $('data-button').addEventListener('click', () => {
    openDialog('data-dialog');
    updateDirectoryInfo();
  });
  $('backup-button').addEventListener('click', () => dataAction(async () => {
    downloadBackup(await recordStore().exportBackup());
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
      state = normaliseState(await recordStore().importBackup(value, { replace: false, revision: state.revision }));
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
  $('cloud-button').addEventListener('click', () => {
    if (actionBusy) return;
    $('cloud-message').textContent = '';
    openDialog('cloud-dialog');
  });
  $('cloud-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!cloudAccount?.user) changeAccount(() => cloudAccount.signIn($('cloud-identifier').value.trim(), $('cloud-password').value));
  });
  $('cloud-sign-out').addEventListener('click', () => {
    if (cloudAccount?.user) changeAccount(() => cloudAccount.signOut());
  });
  $('cloud-use-remote').addEventListener('click', () => {
    changeAccount(async () => {
      const revision = state.revision;
      downloadBackup(await recordStore().exportBackup());
      await cloudAccount.useCloud(revision);
    });
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
    if (!dirty || accountReloading) return;
    event.preventDefault();
    event.returnValue = '';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty) flushAutosave().catch(() => {});
    if (document.visibilityState === 'visible') {
      if (state && state.date !== window.StudyStore.studyDate()) queueCloudRefresh();
      cloudAccount?.sync?.().then(() => queueCloudRefresh()).catch(() => {});
    }
  });
  window.addEventListener('online', () => {
    if (!cloudAccount?.user) return;
    if (dirty) flushAutosave().catch(() => {});
    cloudAccount.sync().then(() => queueCloudRefresh()).catch(() => {});
  });
  window.addEventListener('study-cloud-status', event => {
    $('cloud-status').textContent = event.detail;
    $('cloud-button').title = event.detail;
    $('cloud-use-remote').hidden = !event.detail.startsWith('同步冲突');
  });
  window.setInterval(() => {
    if (state && state.date !== window.StudyStore.studyDate()) queueCloudRefresh();
  }, 1000);
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', async () => {
      try {
        await navigator.serviceWorker.register(new URL('./sw.js', document.baseURI), { scope: './' });
        await navigator.serviceWorker.ready;
        if (!cloudAccount?.user) $('offline-status').textContent = '本机记录支持离线使用。可以收藏这个网址，或通过浏览器菜单安装到桌面。';
      } catch {
        if (!cloudAccount?.user) $('offline-status').textContent = '把这个网址收藏起来，之后联网打开就能继续打卡。';
      }
    });
  }
  start();
})();
