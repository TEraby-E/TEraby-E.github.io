'use strict';

(() => {
  const SUBJECT_NAMES = ['英语', '高数', '线代', '概率论', '数据结构', '计组', '操作系统', '计网'];
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const icon = (name, extraClass = '') => `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const cloneAssignments = () => state.assignments.map((assignment) => ({ ...assignment }));
  let library = [];
  let retiredTasks = new Map();
  let state = null;
  let dirty = false;
  let changeVersion = 0;
  let saveTimer = null;
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
    return { ...value, history: Array.isArray(value.history) ? value.history : [], completed_ids: Array.isArray(value.completed_ids) ? value.completed_ids : [], library_completed_ids: Array.isArray(value.library_completed_ids) ? value.library_completed_ids : [], assignments: value.assignments.map((assignment) => ({ ...assignment, done: Boolean(assignment.done) })) };
  }

  function dateParts(date) {
    const [year, month, day] = date.split('-').map(Number);
    return { year, month, day, value: new Date(year, month - 1, day) };
  }

  function readableDate(date) {
    const { year, month, day } = dateParts(date);
    return `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
  }

  function subjectAssignments(id, assignments = state?.assignments || []) {
    return assignments.filter((assignment) => assignment.subject_id === id);
  }

  function chapterLine(assignment, className) {
    const chapterTitle = String(assignment.chapter_title || library.find((subject) => subject.id === assignment.subject_id)?.chapters.find((chapter) => chapter.id === assignment.chapter_id)?.title || '').trim();
    if (!chapterTitle || String(assignment.title || '').includes(chapterTitle)) return '';
    return `<span class="${className}">${escape(chapterTitle)}</span>`;
  }

  function canonicalTask(task) {
    const id = task.task_id || task.id;
    for (const subject of library) {
      if (task.subject_id && subject.id !== task.subject_id) continue;
      for (const chapter of subject.chapters) {
        const found = chapter.tasks.find((item) => item.id === id);
        if (found) return found;
      }
    }
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

  function estimateBadge(task, className = 'task-estimate') {
    const estimate = taskEstimate(task);
    return `<span class="${className}${estimate.minutes === null ? ' is-unknown' : ''}"${estimate.source ? ` title="${escape(estimate.source)}"` : ''}>${escape(estimateText(task))}</span>`;
  }

  function estimateButton(task) {
    const estimate = taskEstimate(task);
    const hint = [estimate.source, '点击安排今天计划投入的用时'].filter(Boolean).join('；');
    return `<button type="button" class="task-estimate task-estimate-button${estimate.minutes === null ? ' is-unknown' : ''}" data-action="edit-time" data-task="${escape(task.task_id)}" aria-label="安排今日用时：${escape(task.title)}" title="${escape(hint)}">${escape(estimateText(task))}<span class="estimate-edit-hint">调整</span></button>`;
  }

  function taskActual(task) {
    if (window.StudyTime?.getActual) return window.StudyTime.getActual(task);
    const recorded = task.done && typeof task.actual_minutes === 'number' && Number.isFinite(task.actual_minutes) && task.actual_minutes >= 0;
    return { minutes: recorded ? task.actual_minutes : null, recorded, label: !task.done ? '实际待完成' : recorded ? `实际${formattedTime(task.actual_minutes)}` : '实际未记录' };
  }

  function actualButton(task) {
    const actual = taskActual(task);
    return `<button type="button" class="task-estimate task-actual-button${actual.recorded ? ' is-recorded' : ' is-unknown'}" data-action="record-actual" data-task="${escape(task.task_id)}" aria-label="${task.done ? '修改' : '记录'}实际用时：${escape(task.title)}">${escape(actual.label)}<span class="estimate-edit-hint">${task.done ? actual.recorded ? '修改' : '补记' : '打卡'}</span></button>`;
  }

  function comparisonBadge(task) {
    const label = window.StudyTime?.comparisonLabel?.(task, canonicalTask(task)) || `${estimateText(task)} / ${taskActual(task).label}`;
    return `<span class="history-task-estimate">${escape(label)}</span>`;
  }

  function comparisonButtons(task) {
    return `<span class="task-time-comparison">${estimateButton(task)}<span class="time-comparison-slash" aria-hidden="true">/</span>${actualButton(task)}</span>`;
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
      const subjects = [...new Set(rows.map((item) => item.subject_name || library.find((subject) => subject.id === item.subject_id)?.name || ''))].filter(Boolean);
      return `<section class="completion-entry"><div class="completion-entry-copy"><h3>${escape(task.title)}</h3><p>${escape(subjects.join(' · '))}${rows.length > 1 ? ` · ${rows.length} 个共享条目，只计一次` : ''}</p><span class="completion-estimate">${escape(estimateText(task))}</span></div><label class="completion-input-label" for="actual-minutes-${index}">实际用时<span class="completion-input-row"><input id="actual-minutes-${index}" data-completion-index="${index}" type="number" min="0" max="525600" step="any" inputmode="decimal" required placeholder="填写实际分钟" value="${initial}" aria-describedby="completion-help completion-error"><span>分钟</span></span></label></section>`;
    }).join('');
    $('completion-error').hidden = true;
    $('save-completion').textContent = mode === 'edit' ? '保存实际用时' : '保存并打卡';
    openDialog('completion-dialog');
    $('completion-fields').querySelector('input')?.focus({ preventScroll: true });
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
      if (draft.mode === 'complete') task.done = true;
      task.actual_minutes = values[index].minutes;
    }));
    const count = draft.entries.reduce((sum, entry) => sum + entry.taskIds.length, 0);
    const focusId = draft.entries[0].taskIds[0];
    closeDialog('completion-dialog');
    changed();
    [...document.querySelectorAll('#daily-tbody input[data-task]')].find((input) => input.dataset.task === focusId)?.focus({ preventScroll: true });
    try {
      await flushAutosave();
      showToast(draft.mode === 'edit' ? '实际用时已保存。' : `${count} 项任务已打卡，实际用时已保存。`, null, 4500);
    } catch {
      showToast('本次打卡尚未保存，请查看页面提示后重试。', null, 6500);
    }
  }

  function undoCompletion(tasks) {
    expandedCompletionTasks(tasks).forEach((task) => { task.done = false; task.actual_minutes = null; });
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
    [...document.querySelectorAll('.task-estimate-button')].find((button) => button.dataset.task === taskId)?.focus({ preventScroll: true });
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
    $('estimated-time-note').textContent = allUnknown ? `${duration.unknown}项未设预计用时` : duration.unknown ? `另${duration.unknown}项待补充` : '按已选任务汇总';
    $('actual-time').textContent = !duration.actualKnown && duration.actualUnknown ? '待补记' : formattedTime(duration.actualMinutes || 0);
    $('actual-time-note').textContent = duration.actualUnknown ? `另${duration.actualUnknown}项实际用时未记录` : '按已完成任务汇总';
    $('daily-tbody').innerHTML = library.map((subject) => {
      const tasks = subjectAssignments(subject.id);
      const done = tasks.filter((task) => task.done).length;
      const allDone = tasks.length && done === tasks.length;
      const subjectHelp = tasks.length ? (allDone ? '已全部完成' : '整科打卡') : '安排任务';
      const subjectLabel = tasks.length ? `${subject.name}，${allDone ? '取消该科全部完成' : '完成该科全部任务'}` : `${subject.name}，选择章节任务`;
      return `<tr class="${tasks.length ? 'has-tasks' : ''} ${allDone ? 'is-complete' : ''}">
        <td class="subject-cell"><div class="subject-control"><button type="button" class="subject-button" data-action="subject" data-subject="${escape(subject.id)}" aria-label="${escape(subjectLabel)}"><strong>${escape(subject.name)}</strong><span class="subject-help">${subjectHelp}</span></button><button type="button" class="add-task-button" data-action="choose" data-subject="${escape(subject.id)}" aria-label="选择${escape(subject.name)}的章节任务" title="选择章节任务">${icon('plus')}</button></div></td>
        <td>${tasks.length ? `<ul class="task-list">${tasks.map((task) => `<li class="task-item ${task.done ? 'done' : ''}"><div class="task-check"><input id="daily-task-${escape(task.task_id)}" type="checkbox" data-task="${escape(task.task_id)}" ${task.done ? 'checked' : ''} aria-label="${escape(task.title)}，${task.done ? '已完成' : '未完成'}"><div class="task-copy"><label class="task-content-label" for="daily-task-${escape(task.task_id)}">${chapterLine(task, 'task-chapter')}<span class="task-title">${escape(task.title)}</span>${task.detail && task.detail !== task.title ? `<span class="task-detail">${escape(task.detail)}</span>` : ''}</label>${comparisonButtons(task)}</div></div><button type="button" class="remove-task" data-action="remove" data-task="${escape(task.task_id)}" aria-label="从今日清单移除：${escape(task.title)}" title="从今日清单移除">${icon('close')}</button></li>`).join('')}</ul>` : `<div class="empty-row"><span>还没有安排任务</span><button type="button" class="empty-choose" data-action="choose" data-subject="${escape(subject.id)}">选择章节任务${icon('chevron')}</button></div>`}</td>
        <td class="row-progress">${allDone ? `<span class="all-done-icon" aria-label="${done} 项全部完成">${icon('check')}</span>` : tasks.length ? `<span class="done-count">${done}</span><span class="total-count"> / ${tasks.length}</span>` : '<span class="zero-count">—</span>'}</td>
      </tr>`;
    }).join('');
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
    const snapshot = { date: state.date, revision: state.revision, assignments: cloneAssignments(), library_completed_ids: [...state.library_completed_ids] };
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
    const firstSelected = subject.chapters.find((chapter) => chapter.tasks.some((task) => selected.has(task.id)));
    const completed = new Set([...state.completed_ids, ...state.library_completed_ids]);
    const nextChapter = subject.chapters.find((chapter) => chapter.tasks.some((task) => !completed.has(task.id)));
    subjectDraft = { subject, selected, chapterId: firstSelected?.id || nextChapter?.id || subject.chapters[0]?.id, query: '', phase: '' };
    $('library-title').textContent = `${subject.name} · 选择学习任务`;
    $('library-search').value = '';
    $('library-phase').innerHTML = '<option value="">全部阶段</option>' + [...new Set(subject.chapters.map((chapter) => chapter.phase).filter(Boolean))].map((phase) => `<option value="${escape(phase)}">${escape(phase)}</option>`).join('');
    $('library-subject-count').textContent = `${subject.chapters.length} 个章节`;
    renderLibrary();
    openDialog('library-dialog');
    $('library-search').focus({ preventScroll: true });
  }

  function matchesSearch(chapter, task = null) {
    const query = subjectDraft.query.trim().toLocaleLowerCase();
    if (!query) return true;
    const fields = [chapter.title, chapter.phase];
    if (task) fields.push(task.title, task.detail, task.reference, task.quantity, task.remarks);
    return fields.some((field) => String(field ?? '').toLocaleLowerCase().includes(query));
  }

  function filteredChapters() {
    return subjectDraft.subject.chapters.filter((chapter) => (!subjectDraft.phase || chapter.phase === subjectDraft.phase) && (matchesSearch(chapter) || chapter.tasks.some((task) => matchesSearch(chapter, task))));
  }

  function visibleTasks(chapter) {
    return chapter.tasks.filter((task) => matchesSearch(chapter, task));
  }

  function updateSelectionSummary() {
    const size = subjectDraft.selected.size;
    const selected = subjectDraft.subject.chapters.flatMap((chapter) => chapter.tasks.filter((task) => subjectDraft.selected.has(task.id)));
    $('selection-summary').innerHTML = `已选 <strong>${size}</strong> 项任务<span class="selection-time">${escape(summaryText(selected))}</span>`;
    $('apply-library').innerHTML = `${subjectAssignments(subjectDraft.subject.id).length ? '更新今日清单' : '加入今日清单'}${icon('arrow')}`;
  }

  function renderLibraryNavigation() {
    const chapters = filteredChapters();
    $('chapter-list').innerHTML = chapters.length ? chapters.map((chapter) => {
      const chosen = chapter.tasks.filter((task) => subjectDraft.selected.has(task.id)).length;
      return `<button type="button" class="chapter-button" data-chapter="${escape(chapter.id)}" aria-current="${chapter.id === subjectDraft.chapterId}"><span>${chapter.phase ? `<span class="chapter-phase">${escape(chapter.phase)}</span>` : ''}<span>${escape(chapter.title)}</span></span>${chosen ? `<span class="chapter-selected" aria-label="已选 ${chosen} 项">${chosen}</span>` : ''}</button>`;
    }).join('') : '<div class="empty-state"><p>没有匹配的章节</p></div>';
  }

  function renderLibraryContent() {
    const chapter = subjectDraft.subject.chapters.find((item) => item.id === subjectDraft.chapterId);
    if (!chapter) {
      $('chapter-content').innerHTML = `<div class="empty-state">${icon('search')}<strong>${subjectDraft.query ? '没有找到匹配的任务' : '这个科目还没有章节任务'}</strong><p>${subjectDraft.query ? '换一个关键词试试。' : '任务库准备好后会显示在这里。'}</p></div>`;
      return;
    }
    const tasks = visibleTasks(chapter);
    const allChosen = tasks.length && tasks.every((task) => subjectDraft.selected.has(task.id));
    const completed = new Set(state.completed_ids);
    const marked = new Set(state.library_completed_ids);
    const today = new Map(subjectAssignments(subjectDraft.subject.id).map((task) => [task.task_id, task]));
    $('chapter-content').innerHTML = `<div class="chapter-heading"><div><h3>${escape(chapter.title)}</h3><p>${subjectDraft.query ? `找到 ${tasks.length} 项任务` : `${tasks.length} 项学习任务`}</p></div>${tasks.length ? `<button class="text-button" id="toggle-chapter" type="button">${allChosen ? '取消本章全选' : '全选本章'}</button>` : ''}</div><div class="library-tasks">${tasks.map((task) => {
      const selected = subjectDraft.selected.has(task.id);
      const assignment = today.get(task.id);
      const done = Boolean(assignment?.done);
      const libraryDone = marked.has(task.id);
      const metadata = [task.kind, task.quantity, task.reference].filter((value) => value != null && String(value).trim()).map((value) => `<span>${escape(value)}</span>`);
      metadata.unshift(estimateBadge(assignment || task, 'library-task-estimate'));
      if (done || completed.has(task.id)) metadata.push(`<span class="previously-done">${done ? '今日已完成' : '已完成过'}</span>`);
      return `<div class="library-task ${selected ? 'selected' : ''} ${libraryDone ? 'is-complete' : ''}"><label class="library-task-select"><input type="checkbox" data-library-task="${escape(task.id)}" ${selected ? 'checked' : ''}><span class="library-task-copy"><span class="library-task-title">${escape(task.title)}</span>${task.detail && task.detail !== task.title ? `<span class="library-task-detail">${escape(task.detail)}</span>` : ''}${metadata.length ? `<span class="task-metadata">${metadata.join('')}</span>` : ''}${task.remarks ? `<span class="library-task-detail">${escape(task.remarks)}</span>` : ''}</span></label><div class="library-task-actions"><span class="library-mark-hint">仅标记任务库进度</span><button type="button" class="library-complete-button" data-library-complete="${escape(task.id)}" aria-pressed="${libraryDone}" aria-label="${libraryDone ? '取消完成标记' : '标记完成'}：${escape(task.title)}" title="${libraryDone ? '取消任务库完成标记' : '标记已学或跳过的内容，不加入今日清单'}">${icon('check')}<span>${libraryDone ? '已标记完成' : '标记完成'}</span></button></div></div>`;
    }).join('')}</div>`;
  }

  function renderLibrary() {
    const chapters = filteredChapters();
    if (!chapters.some((chapter) => chapter.id === subjectDraft.chapterId)) subjectDraft.chapterId = chapters[0]?.id;
    renderLibraryNavigation();
    renderLibraryContent();
    updateSelectionSummary();
  }

  function refreshLibraryCompletion(taskId) {
    const scrollTop = $('chapter-content').scrollTop;
    const restoreFocus = document.activeElement?.dataset.libraryComplete === taskId;
    renderLibrary();
    $('chapter-content').scrollTop = scrollTop;
    if (restoreFocus) [...$('chapter-content').querySelectorAll('[data-library-complete]')].find((button) => button.dataset.libraryComplete === taskId)?.focus({ preventScroll: true });
  }

  async function toggleLibraryCompletion(taskId) {
    if (!state || !subjectDraft || actionBusy || !$('library-dialog').open) return;
    const draft = subjectDraft;
    const chapter = draft.subject.chapters.find((item) => item.tasks.some((task) => task.id === taskId));
    const task = chapter?.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const marked = new Set(state.library_completed_ids);
    const complete = !marked.has(taskId);
    if (complete) marked.add(taskId);
    else marked.delete(taskId);
    state.library_completed_ids = [...marked];
    changed();
    const version = changeVersion;
    refreshLibraryCompletion(taskId);
    try {
      await flushAutosave();
      if (version !== changeVersion || subjectDraft !== draft || !$('library-dialog').open) return;
      refreshLibraryCompletion(taskId);
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
        replacement.push({ ...(existing.get(task.id) || { task_id: task.id, subject_id: id, chapter_id: chapter.id, title: task.title, detail: task.detail || '', done: false }), subject_name: subjectDraft.subject.name, chapter_title: chapter.title, estimated_minutes: estimate.minutes, estimated_source: estimate.source || '', estimate_group: estimate.group || null });
      }
    }));
    state.assignments = state.assignments.filter((assignment) => assignment.subject_id !== id).concat(replacement, preserved);
    closeDialog('library-dialog');
    changed();
    [...document.querySelectorAll('.add-task-button')].find((element) => element.dataset.subject === id)?.focus({ preventScroll: true });
    showToast(replacement.length ? `${subjectDraft.subject.name}已安排 ${replacement.length} 项任务。${preserved.length ? '既有记录已保留。' : ''}` : preserved.length ? '可选任务已清空，既有记录已保留。' : `已清空${subjectDraft.subject.name}今天的任务。`, null, 3000);
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
        return `<section class="history-subject"><h4>${escape(subject.name)}</h4>${tasks.map((task) => `<div class="history-task"><span class="history-check ${task.done ? 'done' : ''}" aria-label="${task.done ? '已完成' : '未完成'}">${task.done ? icon('check') : ''}</span><span class="history-task-copy">${chapterLine(task, 'history-task-chapter')}<span>${escape(task.title)}</span>${task.detail && task.detail !== task.title ? `<small>${escape(task.detail)}</small>` : ''}${comparisonBadge(task)}</span></div>`).join('')}</section>`;
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
      const freshLibrary = SUBJECT_NAMES.map((name) => libraryResult.subjects.find((subject) => subject.name === name)).filter(Boolean).map((subject) => ({ ...subject, chapters: Array.isArray(subject.chapters) ? subject.chapters.map((chapter) => ({ ...chapter, tasks: Array.isArray(chapter.tasks) ? chapter.tasks : [] })) : [] }));
      const freshRetired = new Map((libraryResult.metadata?.retired_tasks || []).map((task) => [task.id, task]));
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
    } else if (action === 'edit-time') openEstimate(taskId);
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

  $('library-search').addEventListener('input', (event) => {
    if (!subjectDraft) return;
    subjectDraft.query = event.target.value;
    renderLibrary();
  });
  $('library-phase').addEventListener('change', (event) => {
    if (!subjectDraft) return;
    subjectDraft.phase = event.target.value;
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
    [...document.querySelectorAll('[data-chapter]')].find((element) => element.dataset.chapter === subjectDraft.chapterId)?.focus({ preventScroll: true });
  });
  $('chapter-content').addEventListener('change', (event) => {
    const input = event.target.closest('[data-library-task]');
    if (!input || !subjectDraft) return;
    if (input.checked) subjectDraft.selected.add(input.dataset.libraryTask);
    else subjectDraft.selected.delete(input.dataset.libraryTask);
    input.closest('.library-task').classList.toggle('selected', input.checked);
    renderLibraryNavigation();
    updateSelectionSummary();
    const chapter = subjectDraft.subject.chapters.find((item) => item.id === subjectDraft.chapterId);
    const tasks = visibleTasks(chapter);
    $('toggle-chapter').textContent = tasks.every((task) => subjectDraft.selected.has(task.id)) ? '取消本章全选' : '全选本章';
  });
  $('chapter-content').addEventListener('click', (event) => {
    const completion = event.target.closest('[data-library-complete]');
    if (completion) { toggleLibraryCompletion(completion.dataset.libraryComplete); return; }
    if (!event.target.closest('#toggle-chapter') || !subjectDraft) return;
    const chapter = subjectDraft.subject.chapters.find((item) => item.id === subjectDraft.chapterId);
    const tasks = visibleTasks(chapter);
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
