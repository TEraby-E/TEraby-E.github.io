'use strict';

(() => {
  const SUBJECT_NAMES = ['英语', '高数', '线代', '概率论', '数据结构', '计组', '操作系统', '计网'];
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const icon = (name, extraClass = '') => `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const cloneAssignments = () => state.assignments.map((assignment) => ({ ...assignment }));
  let library = [];
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
    return { ...value, history: Array.isArray(value.history) ? value.history : [], completed_ids: Array.isArray(value.completed_ids) ? value.completed_ids : [], assignments: value.assignments.map((assignment) => ({ ...assignment, done: Boolean(assignment.done) })) };
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
    $('daily-tbody').innerHTML = library.map((subject) => {
      const tasks = subjectAssignments(subject.id);
      const done = tasks.filter((task) => task.done).length;
      const allDone = tasks.length && done === tasks.length;
      const subjectHelp = tasks.length ? (allDone ? '已全部完成' : '整科打卡') : '安排任务';
      const subjectLabel = tasks.length ? `${subject.name}，${allDone ? '取消该科全部完成' : '完成该科全部任务'}` : `${subject.name}，选择章节任务`;
      return `<tr class="${tasks.length ? 'has-tasks' : ''} ${allDone ? 'is-complete' : ''}">
        <td class="subject-cell"><div class="subject-control"><button type="button" class="subject-button" data-action="subject" data-subject="${escape(subject.id)}" aria-label="${escape(subjectLabel)}"><strong>${escape(subject.name)}</strong><span class="subject-help">${subjectHelp}</span></button><button type="button" class="add-task-button" data-action="choose" data-subject="${escape(subject.id)}" aria-label="选择${escape(subject.name)}的章节任务" title="选择章节任务">${icon('plus')}</button></div></td>
        <td>${tasks.length ? `<ul class="task-list">${tasks.map((task) => `<li class="task-item ${task.done ? 'done' : ''}"><label class="task-check"><input type="checkbox" data-task="${escape(task.task_id)}" ${task.done ? 'checked' : ''} aria-label="${escape(task.title)}，${task.done ? '已完成' : '未完成'}"><span class="task-copy">${chapterLine(task, 'task-chapter')}<span class="task-title">${escape(task.title)}</span>${task.detail && task.detail !== task.title ? `<span class="task-detail">${escape(task.detail)}</span>` : ''}</span></label><button type="button" class="remove-task" data-action="remove" data-task="${escape(task.task_id)}" aria-label="从今日清单移除：${escape(task.title)}" title="从今日清单移除">${icon('close')}</button></li>`).join('')}</ul>` : `<div class="empty-row"><span>还没有安排任务</span><button type="button" class="empty-choose" data-action="choose" data-subject="${escape(subject.id)}">选择章节任务${icon('chevron')}</button></div>`}</td>
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
    const snapshot = { date: state.date, revision: state.revision, assignments: cloneAssignments() };
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
    const selected = new Set(subjectAssignments(id).map((assignment) => assignment.task_id));
    const firstSelected = subject.chapters.find((chapter) => chapter.tasks.some((task) => selected.has(task.id)));
    const completed = new Set(state.completed_ids);
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
    $('selection-summary').innerHTML = `已选 <strong>${size}</strong> 项任务`;
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
    $('chapter-content').innerHTML = `<div class="chapter-heading"><div><h3>${escape(chapter.title)}</h3><p>${subjectDraft.query ? `找到 ${tasks.length} 项任务` : `${tasks.length} 项学习任务`}</p></div>${tasks.length ? `<button class="text-button" id="toggle-chapter" type="button">${allChosen ? '取消本章全选' : '全选本章'}</button>` : ''}</div><div class="library-tasks">${tasks.map((task) => {
      const selected = subjectDraft.selected.has(task.id);
      const metadata = [task.kind, task.quantity, task.reference].filter((value) => value != null && String(value).trim()).map((value) => `<span>${escape(value)}</span>`);
      if (completed.has(task.id)) metadata.push('<span class="previously-done">已完成过</span>');
      return `<label class="library-task ${selected ? 'selected' : ''}"><input type="checkbox" data-library-task="${escape(task.id)}" ${selected ? 'checked' : ''}><span class="library-task-copy"><span class="library-task-title">${escape(task.title)}</span>${task.detail && task.detail !== task.title ? `<span class="library-task-detail">${escape(task.detail)}</span>` : ''}${metadata.length ? `<span class="task-metadata">${metadata.join('')}</span>` : ''}${task.remarks ? `<span class="library-task-detail">${escape(task.remarks)}</span>` : ''}</span></label>`;
    }).join('')}</div>`;
  }

  function renderLibrary() {
    const chapters = filteredChapters();
    if (!chapters.some((chapter) => chapter.id === subjectDraft.chapterId)) subjectDraft.chapterId = chapters[0]?.id;
    renderLibraryNavigation();
    renderLibraryContent();
    updateSelectionSummary();
  }

  function applyLibrary() {
    if (!subjectDraft || actionBusy) return;
    const id = subjectDraft.subject.id;
    const existing = new Map(subjectAssignments(id).map((assignment) => [assignment.task_id, assignment]));
    const replacement = [];
    subjectDraft.subject.chapters.forEach((chapter) => chapter.tasks.forEach((task) => {
      if (subjectDraft.selected.has(task.id)) replacement.push({ ...(existing.get(task.id) || { task_id: task.id, subject_id: id, chapter_id: chapter.id, title: task.title, detail: task.detail || '', done: false }), subject_name: subjectDraft.subject.name, chapter_title: chapter.title });
    }));
    state.assignments = state.assignments.filter((assignment) => assignment.subject_id !== id).concat(replacement);
    closeDialog('library-dialog');
    changed();
    [...document.querySelectorAll('.add-task-button')].find((element) => element.dataset.subject === id)?.focus({ preventScroll: true });
    showToast(replacement.length ? `${subjectDraft.subject.name}已安排 ${replacement.length} 项任务。` : `已清空${subjectDraft.subject.name}今天的任务。`, null, 3000);
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
      $('history-content').innerHTML = `<div class="history-detail-heading"><h3>${escape(readableDate(date))}</h3><span>完成 ${completed} / ${assignments.length} 项任务</span></div>${assignments.length ? library.map((subject) => {
        const tasks = subjectAssignments(subject.id, assignments);
        if (!tasks.length) return '';
        return `<section class="history-subject"><h4>${escape(subject.name)}</h4>${tasks.map((task) => `<div class="history-task"><span class="history-check ${task.done ? 'done' : ''}" aria-label="${task.done ? '已完成' : '未完成'}">${task.done ? icon('check') : ''}</span><span class="history-task-copy">${chapterLine(task, 'history-task-chapter')}<span>${escape(task.title)}</span>${task.detail && task.detail !== task.title ? `<small>${escape(task.detail)}</small>` : ''}</span></div>`).join('')}</section>`;
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
      if (freshLibrary.length !== SUBJECT_NAMES.length) throw new Error('章节任务库缺少科目，请重新载入任务库。');
      const fresh = normaliseState(stateResult);
      if (state && fresh.revision < state.revision) return;
      const externalUpdate = state && fresh.revision !== state.revision;
      if (externalUpdate) {
        const choosing = $('library-dialog').open;
        closeDialog('library-dialog');
        closeDialog('archive-dialog');
        subjectDraft = null;
        if (choosing) showToast('另一页面更新了学习记录，请按最新进度重新选择任务。', null, 6500);
      }
      library = freshLibrary;
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
        assignments.forEach((assignment) => { assignment.done = !allDone; });
        changed();
        const replacement = [...document.querySelectorAll('.subject-button')].find((element) => element.dataset.subject === subjectId);
        replacement?.focus({ preventScroll: true });
      }
    } else if (action === 'remove') {
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
    assignment.done = input.checked;
    const taskId = input.dataset.task;
    changed();
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
    if (!event.target.closest('#toggle-chapter') || !subjectDraft) return;
    const chapter = subjectDraft.subject.chapters.find((item) => item.id === subjectDraft.chapterId);
    const tasks = visibleTasks(chapter);
    const allChosen = tasks.every((task) => subjectDraft.selected.has(task.id));
    tasks.forEach((task) => allChosen ? subjectDraft.selected.delete(task.id) : subjectDraft.selected.add(task.id));
    renderLibrary();
    $('toggle-chapter')?.focus({ preventScroll: true });
  });

  $('apply-library').addEventListener('click', applyLibrary);
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
