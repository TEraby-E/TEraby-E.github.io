/* Study record operations and browser-local persistence. */
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
  const FULL_BACKUP_VERSION = 2;
  const PLAN_FORMAT = 'study-journal-plan';
  const DEFAULT_PLAN_VERSION = 3;
  const MAX_PLAN_TASKS = 500;
  const MAX_TASKS = 100;
  const MAX_ARCHIVES = 36525;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const models = () => root.StudyModels || (typeof module === 'object' && module.exports ? require('./learning-model.js') : null);
  const studyTime = () => root.StudyTime || (typeof module === 'object' && module.exports ? require('./study-time.js') : null);

  const isCustomSubject = id => typeof id === 'string' && /^custom-subject-[\w-]{1,185}$/.test(id);
  const isSubjectId = id => typeof id === 'string' && (Object.hasOwn(SUBJECTS, id) || isCustomSubject(id));
  const isSubjectName = name => typeof name === 'string' && Boolean(name.trim()) && name.length <= 100;
  const isPhaseName = name => typeof name === 'string' && Boolean(name.trim()) && name.length <= 200;
  const subjectName = (index, id) => index?.subjects
    ? index.subjects.get(id)?.name
    : Object.hasOwn(SUBJECTS, id) ? SUBJECTS[id] : undefined;

  function compareSubjects(index, a, b) {
    if (index?.subjectOrder) {
      const last = index.subjectOrder.size;
      return (index.subjectOrder.get(a) ?? last) - (index.subjectOrder.get(b) ?? last);
    }
    const rank = id => Object.hasOwn(SUBJECTS, id) ? SUBJECT_ORDER.indexOf(id) : SUBJECT_ORDER.length;
    return rank(a) - rank(b);
  }

  function copyLearningInfo(row, item, section = null) {
    const annotation = models().splitRemark(item.remarks);
    if (!section && !Object.hasOwn(item, 'section_name') && !Object.hasOwn(item, 'exam_frequency') && !Object.hasOwn(item, 'difficulty') && annotation.difficulty === null && annotation.exam_frequency.small === null && annotation.exam_frequency.large === null) return;
    const info = models().learningInfo(item, section, annotation);
    const validCount = value => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 100000);
    if (typeof info.section_name !== 'string' || info.section_name.length > 400 ||
        (info.difficulty !== null && !/^☆{1,5}$/.test(info.difficulty)) ||
        !validCount(info.exam_frequency?.small) || !validCount(info.exam_frequency?.large) ||
        (info.section_estimated_minutes !== null && (typeof info.section_estimated_minutes !== 'number' || !Number.isFinite(info.section_estimated_minutes) || info.section_estimated_minutes < 0))) throw new StoreError('小节难度、考频或参考用时格式不正确。');
    Object.assign(row, info);
  }

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

  function freezeLibrary(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freezeLibrary);
      Object.freeze(value);
    }
    return value;
  }

  function libraryIndex(library) {
    if (!library || !Array.isArray(library.subjects)) throw new StoreError('章节任务库的格式不正确。');
    const index = new Map();
    index.subjects = new Map();
    index.subjectOrder = new Map();
    index.subjectModels = new Map();
    index.groups = new Map();
    index.subjectPhases = new Map();
    index.phaseAliases = library.metadata?.phase_aliases || {};
    for (const subject of library.subjects) {
      if (!isSubjectId(subject?.id) || index.subjects.has(subject.id) || !isSubjectName(subject.name) ||
          !Array.isArray(subject.chapters)) throw new StoreError('章节任务库的科目不正确或重复。');
      if (Object.hasOwn(subject, 'phases') && (!Array.isArray(subject.phases) ||
          subject.phases.some(phase => !isPhaseName(phase)) ||
          new Set(subject.phases).size !== subject.phases.length)) throw new StoreError('大章名称格式不正确或重复。');
      index.subjectOrder.set(subject.id, index.subjects.size);
      index.subjects.set(subject.id, subject);
      const subjectModel = models().createSubject(subject);
      index.subjectPhases.set(subject.id, new Set(subjectModel.phases));
      index.subjectModels.set(subject.id, subjectModel);
      for (const chapter of subject.chapters) {
        if (typeof chapter?.id !== 'string' || !Array.isArray(chapter.tasks)) throw new StoreError('章节任务库的章节不正确。');
        for (const task of chapter.tasks) {
          if (typeof task?.id !== 'string' || index.has(task.id)) throw new StoreError('章节任务库含有重复或无效任务。');
          index.set(task.id, { subject, chapter, task, section: subjectModel.sectionFor(task) });
          const group = task.estimate_group || task.id;
          if (!index.groups.has(group)) index.groups.set(group, []);
          index.groups.get(group).push(task.id);
        }
      }
    }
    index.retired = new Map();
    for (const item of library.metadata?.retired_tasks || []) {
      if (!item || typeof item.id !== 'string' || !isSubjectId(item.subject_id) ||
          (item.subject_name != null && !isSubjectName(item.subject_name)) ||
          index.has(item.id) || index.retired.has(item.id)) throw new StoreError('已停用任务的登记格式不正确。');
      index.retired.set(item.id, item);
    }
    return index;
  }

  function normaliseAssignments(assignments, index, { preserveSnapshots = false, preserveOrder = false, limit = MAX_TASKS } = {}) {
    if (!Array.isArray(assignments) || assignments.length > limit) throw new StoreError('每天最多选择 100 项任务。');
    const seen = new Set();
    const result = assignments.map((item) => {
      if (!item || typeof item !== 'object' || typeof item.task_id !== 'string' || item.task_id.length > 200) throw new StoreError('任务格式不正确。');
      if (seen.has(item.task_id)) throw new StoreError('同一天不能重复添加同一项任务。');
      seen.add(item.task_id);
      if ('done' in item && typeof item.done !== 'boolean') throw new StoreError('打卡状态不正确。');
      let row;
      const canonical = index.get(item.task_id);
      const retired = index.retired?.get(item.task_id);
      const definition = canonical?.task || retired || {};
      const currentSubjectName = subjectName(index, item.subject_id);
      const savedSubjectName = preserveSnapshots && isSubjectId(item.subject_id)
        ? (isSubjectName(item.subject_name) ? item.subject_name : currentSubjectName || subjectName(null, item.subject_id))
        : undefined;
      if (canonical) {
        const { subject, chapter, task } = canonical;
        row = Object.fromEntries(['title', 'detail', 'kind', 'reference', 'quantity', 'remarks'].map((key) => [key, String(task[key] ?? '')]));
        Object.assign(row, { task_id: task.id, subject_id: subject.id, subject_name: subject.name, chapter_id: chapter.id, chapter_title: chapter.title });
      } else if (retired && (retired.subject_id === item.subject_id || savedSubjectName)) {
        if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 400) throw new StoreError('已停用任务缺少原保存的名称，无法恢复记录。');
        row = { task_id: item.task_id, subject_id: savedSubjectName ? item.subject_id : retired.subject_id,
          subject_name: savedSubjectName || currentSubjectName || retired.subject_name || subjectName(null, retired.subject_id) || retired.subject_id };
        for (const key of ['title', 'detail', 'kind', 'reference', 'quantity', 'remarks', 'chapter_id', 'chapter_title']) {
          const value = item[key] ?? '';
          if (typeof value !== 'string' || value.length > (key === 'title' || key === 'chapter_title' ? 400 : 10000)) throw new StoreError('已保存任务的内容格式不正确。');
          row[key] = value;
        }
      } else if (item.task_id.startsWith('custom-') && currentSubjectName) {
        if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 400 || (item.detail !== undefined && typeof item.detail !== 'string') || (item.detail || '').length > 10000) throw new StoreError('请填写有效的任务名称。');
        row = { task_id: item.task_id, subject_id: item.subject_id, subject_name: savedSubjectName || currentSubjectName, chapter_id: 'custom', chapter_title: '自定义任务', title: item.title.trim(), detail: (item.detail || '').trim(), kind: '自定义', reference: '', quantity: '', remarks: '' };
      } else throw new StoreError('任务库中未找到这项任务，请重新选择。');
      if (preserveSnapshots && canonical && typeof item.title === 'string') {
        for (const key of ['title', 'detail', 'kind', 'reference', 'quantity', 'remarks', 'chapter_id', 'chapter_title']) {
          const value = item[key] ?? row[key];
          if (typeof value !== 'string' || value.length > (['title', 'chapter_title'].includes(key) ? 400 : key === 'chapter_id' ? 200 : 10000) || (key === 'title' && !value.trim())) throw new StoreError('已保存任务的内容格式不正确。');
          row[key] = value;
        }
        if (savedSubjectName || currentSubjectName) {
          row.subject_id = item.subject_id;
          row.subject_name = savedSubjectName || currentSubjectName;
        }
      }
      const estimate = Object.hasOwn(item, 'estimated_minutes') ? item : definition;
      if (Object.hasOwn(estimate, 'estimated_minutes') && estimate.estimated_minutes !== null &&
          (typeof estimate.estimated_minutes !== 'number' || !Number.isFinite(estimate.estimated_minutes) || estimate.estimated_minutes < 0 || estimate.estimated_minutes > 525600)) throw new StoreError('预计用时必须是有效的分钟数，未填写时请留空。');
      const source = Object.hasOwn(estimate, 'estimated_source') ? estimate.estimated_source : definition.estimated_source ?? '';
      const group = Object.hasOwn(estimate, 'estimate_group') ? estimate.estimate_group : definition.estimate_group ?? null;
      if (typeof source !== 'string' || source.length > 500 || (group !== null && (typeof group !== 'string' || group.length > 200))) throw new StoreError('预计用时来源或分组格式不正确。');
      row.estimated_minutes = estimate.estimated_minutes ?? null;
      row.estimated_source = source;
      row.estimate_group = group;
      const video = estimate.source_video_minutes ?? definition.source_video_minutes;
      if (typeof video === 'number' && Number.isFinite(video) && video >= 0 && video <= 525600) row.source_video_minutes = video;
      const mode = item.task_mode ?? definition.task_mode ?? 'single-day';
      if (!['single-day', 'multi-day'].includes(mode)) throw new StoreError('任务类别不正确。');
      row.task_mode = mode;
      if (Object.hasOwn(item, 'overall_completed')) {
        if (typeof item.overall_completed !== 'boolean') throw new StoreError('任务整体完成状态不正确。');
        row.overall_completed = item.overall_completed;
      }
      row.done = item.done ?? false;
      const actual = item.actual_minutes ?? null;
      if (actual !== null && (typeof actual !== 'number' || !Number.isFinite(actual) || actual < 0 || actual > 525600)) throw new StoreError('实际用时必须是有效的分钟数，未记录时请留空。');
      row.actual_minutes = row.done ? actual : null;
      if (Object.hasOwn(item, 'checkin_segments')) {
        if (!Array.isArray(item.checkin_segments) || item.checkin_segments.length > 2000 || item.checkin_segments.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 525600)) throw new StoreError('学习片段用时格式不正确。');
        const total = models().sumSegments(item.checkin_segments);
        if (row.done && (actual === null || Math.abs(total - actual) > 1e-7)) throw new StoreError('学习片段合计与当天实际用时不一致。');
        row.checkin_segments = row.done ? [...item.checkin_segments] : [];
      }
      const hasSnapshotInfo = preserveSnapshots && ['section_name', 'difficulty', 'exam_frequency'].some(key => Object.hasOwn(item, key));
      copyLearningInfo(row, hasSnapshotInfo ? item : canonical ? canonical.task : item, hasSnapshotInfo ? null : canonical?.section);
      const subjectModel = index.subjectModels?.get(row.subject_id) || models().createSubject({ id: row.subject_id });
      if (subjectModel.supportsLearningInfo) {
        row.remarks = models().splitRemark(row.remarks).text;
      }
      return row;
    });
    return preserveOrder ? result : result.sort((a, b) => compareSubjects(index, a.subject_id, b.subject_id));
  }

  function initialRecord(date = localDate()) {
    return { revision: 1, current: { date: validateDate(date), assignments: [] }, archives: [] };
  }

  function normalisePlan(tasks, subjectsIndex) {
    if (!Array.isArray(tasks) || tasks.length > MAX_PLAN_TASKS) throw new StoreError(`学习计划最多包含 ${MAX_PLAN_TASKS} 项任务。`);
    const ids = new Set();
    const index = new Map();
    index.subjects = subjectsIndex?.subjects;
    return tasks.map(task => {
      if (typeof task?.task_id !== 'string' || !/^custom-[\w-]{1,193}$/.test(task.task_id) || ids.has(task.task_id)) {
        throw new StoreError('计划任务标识无效或重复。');
      }
      const { task_id, subject_id, title, detail } = normaliseAssignments([{ task_id: task.task_id, subject_id: task.subject_id, title: task.title, detail: task.detail }], index)[0];
      ids.add(task_id);
      return { task_id, subject_id, title, detail };
    });
  }

  function mergePlans(existing, incoming, index) {
    return normalisePlan([...new Map([...incoming, ...existing].map(task => [task.task_id, task])).values()], index);
  }

  function validateCatalogue(value) {
    if (!value || !Array.isArray(value.subjects)) throw new StoreError('计划中的学科格式不正确。');
    const catalogue = copy(value);
    let total = 0;
    const chapterIds = new Set();
    for (const subject of catalogue.subjects) {
      if (!Array.isArray(subject?.chapters) || subject.chapters.length > 1000) throw new StoreError('计划章节格式不正确。');
      for (const chapter of subject.chapters) {
        if (typeof chapter?.id !== 'string' || !/^[\w-]{1,200}$/.test(chapter.id) || chapterIds.has(chapter.id) ||
            typeof chapter.title !== 'string' || chapter.title.length > 400 ||
            (chapter.phase != null && (typeof chapter.phase !== 'string' || chapter.phase.length > 200)) || !Array.isArray(chapter.tasks)) throw new StoreError('计划章节格式不正确。');
        chapterIds.add(chapter.id);
        for (const task of chapter.tasks) {
          if (++total > 10000 || typeof task?.id !== 'string' || !/^[\w-]{1,200}$/.test(task.id) ||
              typeof task.title !== 'string' || !task.title.trim() || task.title.length > 400) throw new StoreError('计划任务格式不正确，最多支持 10000 项。');
          for (const key of ['detail', 'kind', 'reference', 'quantity', 'remarks']) {
            if (task[key] != null && (typeof task[key] !== 'string' || task[key].length > 10000)) throw new StoreError('计划内容格式不正确。');
          }
        }
      }
    }
    const index = libraryIndex(catalogue);
    for (const { subject, task } of index.values()) normaliseAssignments([{ task_id: task.id, subject_id: subject.id }], index);
    return catalogue;
  }

  function planEntries(catalogue) {
    return catalogue.subjects.flatMap(subject => subject.chapters.flatMap(chapter => chapter.tasks.map(task => ({
      ...task, task_id: task.id, subject_id: subject.id, chapter_id: chapter.id, chapter_title: chapter.title, phase: chapter.phase || '',
    }))));
  }

  function planSubject(catalogue, id) {
    const subject = catalogue.subjects.find(item => item.id === id);
    if (!subject) throw new StoreError('请选择有效的学科。');
    return subject;
  }

  function updatePlanSubject(catalogue, { id, name }) {
    if (!isCustomSubject(id)) throw new StoreError('请选择自定义学科。');
    const title = typeof name === 'string' ? name.trim() : '';
    if (!isSubjectName(title)) throw new StoreError('请填写有效的学科名称。');
    const next = copy(catalogue);
    if (next.subjects.some(subject => subject.id !== id && subject.name.trim() === title)) throw new StoreError('已有同名学科。');
    const subject = next.subjects.find(item => item.id === id);
    if (subject) subject.name = title;
    else next.subjects.push({ id, name: title, chapters: [] });
    if (next.metadata && Object.hasOwn(next.metadata, 'subject_count')) next.metadata.subject_count = next.subjects.length;
    return validateCatalogue(next);
  }

  function isCustomChapter(id) {
    return typeof id === 'string' && /^custom-chapter-[\w-]{1,185}$/.test(id);
  }

  function addPlanPhase(catalogue, { subject_id, name }) {
    const phase = typeof name === 'string' ? name.trim() : '';
    if (!isPhaseName(phase)) throw new StoreError('请填写有效的大章名称。');
    const next = copy(catalogue);
    const subject = planSubject(next, subject_id);
    const phases = models().createSubject(subject).phases.filter(isPhaseName);
    if (phases.includes(phase)) throw new StoreError('该学科已有同名大章。');
    subject.phases = [...phases, phase];
    return validateCatalogue(next);
  }

  function preserveEmptyParent(subject, chapter) {
    const phase = chapter.phase;
    if (isPhaseName(phase) && !subject.phases?.includes(phase) &&
        !subject.chapters.some(item => item !== chapter && item.phase === phase)) {
      subject.phases = models().createSubject(subject).phases.filter(isPhaseName);
    }
  }

  function updatePlanChapter(catalogue, { id, subject_id, title, phase }) {
    if (!isCustomChapter(id)) throw new StoreError('请选择自定义章节。');
    const name = typeof title === 'string' ? title.trim() : '';
    if (!name || name.length > 400) throw new StoreError('请填写有效的章节名称。');
    const next = copy(catalogue);
    const subject = planSubject(next, subject_id);
    const chapter = subject.chapters.find(item => item.id === id);
    const selectedPhase = phase ?? chapter?.phase ?? '';
    if (selectedPhase !== '' && !models().createSubject(subject).phases.includes(selectedPhase)) {
      throw new StoreError('请选择此学科已有的学习阶段。');
    }
    if (subject.chapters.some(item => item.id !== id && (item.phase || '') === selectedPhase && item.title.trim() === name)) {
      throw new StoreError('该阶段已有同名章节。');
    }
    if (chapter) {
      if (chapter.phase !== selectedPhase) preserveEmptyParent(subject, chapter);
      Object.assign(chapter, { title: name, phase: selectedPhase });
    } else subject.chapters.push({ id, title: name, phase: selectedPhase, tasks: [] });
    return validateCatalogue(next);
  }

  function putPlanTask(next, entry) {
    const subject = planSubject(next, entry.subject_id);
    let definition;
    let originalChapter;
    let originalPosition;
    for (const item of next.subjects) for (const chapter of item.chapters) {
      const previous = chapter.tasks.find(task => task.id === entry.task_id);
      if (previous) { definition = previous; originalChapter = chapter; originalPosition = chapter.tasks.indexOf(previous); }
      chapter.tasks = chapter.tasks.filter(task => task.id !== entry.task_id);
    }
    let chapter = subject.chapters.find(item => item.id === entry.chapter_id);
    if (!chapter && isCustomChapter(entry.chapter_id)) throw new StoreError('这个章节已不存在，请重新选择。');
    if (!chapter && entry.chapter_id === undefined && originalChapter && subject.chapters.includes(originalChapter)) chapter = originalChapter;
    if (!chapter) {
      chapter = subject.chapters.find(item => item.id === `personal-${subject.id}`);
      if (!chapter) { chapter = { id: `personal-${subject.id}`, title: '我的任务', phase: '', tasks: [] }; subject.chapters.push(chapter); }
    }
    const task = { ...definition, id: entry.task_id, title: entry.title.trim(), detail: entry.detail || '', task_mode: entry.task_mode || definition?.task_mode || 'single-day' };
    if (Object.hasOwn(entry, 'estimated_minutes')) {
      task.estimated_minutes = entry.estimated_minutes;
      if (entry.estimated_minutes !== definition?.estimated_minutes) task.estimated_source = entry.estimated_minutes === null ? '' : '用户计划';
    }
    if (chapter === originalChapter) chapter.tasks.splice(originalPosition, 0, task);
    else chapter.tasks.push(task);
    return next;
  }

  function updatePlan(catalogue, entry) {
    if (entry.chapter_id && !planSubject(catalogue, entry.subject_id).chapters.some(chapter => chapter.id === entry.chapter_id)) {
      throw new StoreError('这个章节已不存在，请重新选择。');
    }
    return validateCatalogue(putPlanTask(copy(catalogue), entry));
  }

  function removePlanTask(catalogue, id) {
    const next = copy(catalogue);
    next.metadata ||= {};
    next.metadata.retired_tasks ||= [];
    for (const subject of next.subjects) for (const chapter of subject.chapters) {
      const task = chapter.tasks.find(item => item.id === id);
      if (task && !next.metadata.retired_tasks.some(item => item.id === id)) {
        next.metadata.retired_tasks.push({ ...task, subject_id: subject.id, subject_name: subject.name });
      }
      chapter.tasks = chapter.tasks.filter(item => item.id !== id);
    }
    return validateCatalogue(next);
  }

  function mergeCatalogues(existing, incoming) {
    const next = copy(existing);
    const subjects = new Map(next.subjects.map(subject => [subject.id, subject]));
    const ids = new Set(planEntries(next).map(task => task.task_id));
    const retired = new Set(next.metadata?.retired_tasks?.map(task => task.id) || []);
    for (const subject of incoming.subjects) {
      let target = subjects.get(subject.id);
      if (!target) {
        target = { ...copy(subject), chapters: [] };
        next.subjects.push(target);
        subjects.set(target.id, target);
      }
      if (subject.phases?.length) {
        const phases = models().createSubject(target).phases.filter(isPhaseName);
        target.phases = [...new Set([...phases, ...subject.phases])];
      }
      for (const chapter of subject.chapters) {
        const tasks = chapter.tasks.filter(task => !ids.has(task.id) && !retired.has(task.id));
        tasks.forEach(task => ids.add(task.id));
        if (!tasks.length && !isCustomChapter(chapter.id)) continue;
        let destination = target.chapters.find(item => item.id === chapter.id);
        if (!destination) { destination = { ...copy(chapter), tasks: [] }; target.chapters.push(destination); }
        destination.tasks.push(...copy(tasks));
      }
      if (subject.sections) target.sections = { ...copy(subject.sections), ...(target.sections || {}) };
    }
    next.metadata ||= {};
    next.metadata.retired_tasks = [...new Map([...(existing.metadata?.retired_tasks || []), ...(incoming.metadata?.retired_tasks || [])].filter(task => !ids.has(task.id)).map(task => [task.id, task])).values()];
    return validateCatalogue(next);
  }

  function migratePlan(base, record) {
    if (record.plan_library) return record;
    const snapshots = [...(record.archives || []), record.current].filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
    const custom = snapshots.flatMap(day => day.assignments.filter(task => task.task_id.startsWith('custom-')));
    const legacy = new Map([...custom, ...(record.plan_tasks || [])].map(task => [task.task_id, task]));
    if (!legacy.size) return { ...record, plan_library: base, revision: record.revision + 1 };
    const catalogue = copy(base);
    for (const task of legacy.values()) putPlanTask(catalogue, task);
    return { ...record, plan_library: validateCatalogue(catalogue), revision: record.revision + 1 };
  }

  function refreshDefaultPlan(base, record) {
    const previous = record.plan_library;
    const known = id => base.index.has(id) || base.index.retired.has(id);
    const hasExtraTasks = previous.subjects.some(subject => isCustomSubject(subject.id) || subject.phases?.length ||
      subject.chapters.some(chapter => isCustomChapter(chapter.id) || chapter.tasks.some(task => !known(task.id))));
    const hasExtraRetiredIds = previous.metadata?.retired_tasks?.some(task => !known(task.id));
    const catalogue = hasExtraTasks || hasExtraRetiredIds ? mergeCatalogues(base.library, previous) : base.library;
    return { ...record, plan_library: catalogue, revision: record.revision + 1 };
  }

  function normaliseLibraryCompletedIds(value, index) {
    if (!Array.isArray(value) || value.length > index.size + (index.retired?.size || 0)) throw new StoreError('任务库完成标记的格式不正确。');
    if (value.some((id) => typeof id !== 'string' || id.length > 200 || (!index.has(id) && !index.retired?.has(id)))) throw new StoreError('任务库中未找到已标记的任务，请重新载入后再试。');
    return [...new Set(value)].sort();
  }

  function normaliseTaskModes(value, index) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > index.size + (index.retired?.size || 0)) throw new StoreError('任务类别设置不正确。');
    const result = {};
    for (const [id, mode] of Object.entries(value)) {
      if ((!index.has(id) && !index.retired?.has(id)) || !['single-day', 'multi-day'].includes(mode)) throw new StoreError('任务类别设置不正确。');
      result[id] = mode;
    }
    return result;
  }

  function normaliseSubjectPhases(value, index) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length > (index.subjects?.size ?? SUBJECT_ORDER.length)) throw new StoreError('学科学习阶段设置不正确。');
    const result = {};
    for (const [id, savedPhase] of Object.entries(value)) {
      const phase = index.subjectPhases?.get(id)?.has(savedPhase) ? savedPhase : index.phaseAliases?.[id]?.[savedPhase] ?? savedPhase;
      if (!subjectName(index, id) || typeof phase !== 'string' ||
          (phase !== '' && !index.subjectPhases?.get(id)?.has(phase))) throw new StoreError('学科学习阶段不存在，请重新选择。');
      result[id] = phase;
    }
    return result;
  }

  function hydrateRecordEstimates(record, index) {
    if (record.plan_customized) return record;
    const phases = record.subject_phases && normaliseSubjectPhases(record.subject_phases, index);
    const phaseChanged = phases && Object.entries(phases).some(([id, phase]) => record.subject_phases[id] !== phase);
    const hydrateDay = (day) => {
      let assignments;
      day.assignments.forEach((task, position) => {
        const entry = index.get(task.task_id);
        const changes = {};
        if (entry?.section && !Object.hasOwn(task, 'section_name')) copyLearningInfo(changes, entry.task, entry.section);
        if (/〔原图/.test(task.remarks || '') && entry?.task.remarks && !/〔原图/.test(entry.task.remarks)) changes.remarks = entry.task.remarks;
        const remarks = changes.remarks ?? task.remarks;
        const subjectModel = index.subjectModels.get(task.subject_id) || models().createSubject({ id: task.subject_id });
        if (remarks && subjectModel.supportsLearningInfo) {
          const cleaned = models().splitRemark(remarks);
          if (cleaned.text !== remarks) {
            const info = models().learningInfo({ ...task, ...changes }, entry?.section);
            changes.difficulty = info.difficulty;
            changes.exam_frequency = info.exam_frequency;
            changes.remarks = cleaned.text;
          }
        }
        if (!Object.hasOwn(task, 'task_mode')) changes.task_mode = record.task_modes?.[task.task_id] || entry?.task.task_mode || 'single-day';
        if (!Object.hasOwn(task, 'actual_minutes')) changes.actual_minutes = null;
        if (!Object.hasOwn(task, 'estimated_minutes')) {
          const original = entry?.task || index.retired?.get(task.task_id);
          changes.estimated_minutes = original?.estimated_minutes ?? null;
          changes.estimated_source = original?.estimated_source || '原资料未提供预计用时';
          changes.estimate_group = original?.estimate_group || null;
          if (typeof original?.source_video_minutes === 'number') changes.source_video_minutes = original.source_video_minutes;
        }
        if (!Object.keys(changes).length) return;
        assignments ||= [...day.assignments];
        assignments[position] = { ...task, ...changes };
      });
      return assignments ? { ...day, assignments } : day;
    };
    const current = hydrateDay(record.current);
    const archives = record.archives.map(hydrateDay);
    if (!phaseChanged && current === record.current && archives.every((day, index) => day === record.archives[index])) return record;
    return { ...record, ...(phaseChanged ? { subject_phases: phases } : {}), current, archives, revision: record.revision + 1 };
  }

  function stateOf(record) {
    const completed = new Set();
    const history = [];
    const task_progress = Object.create(null);
    for (const day of [record.current, ...record.archives]) {
      if (day.date > record.current.date) continue;
      let count = 0;
      for (const task of day.assignments) {
        if (!task.done) continue;
        count += 1;
        if ((record.task_modes?.[task.task_id] || task.task_mode) !== 'multi-day') completed.add(task.task_id);
        const progress = task_progress[task.task_id] ||= { checkins: 0, actual_minutes: 0, segments: 0 };
        progress.checkins += 1;
        progress.segments += Array.isArray(task.checkin_segments) ? task.checkin_segments.length : Number(Number.isFinite(task.actual_minutes));
        if (typeof task.actual_minutes === 'number') progress.actual_minutes += task.actual_minutes;
      }
      if (count && day.date < record.current.date) history.push({ date: day.date, total: count, completed: count });
    }
    history.sort((a, b) => b.date.localeCompare(a.date));
    return copy({ date: record.current.date, revision: record.revision, assignments: record.current.assignments, history, completed_ids: [...completed].sort(), library_completed_ids: Array.isArray(record.library_completed_ids) ? record.library_completed_ids : [], library_reopened_ids: Array.isArray(record.library_reopened_ids) ? record.library_reopened_ids : [], task_modes: record.task_modes || {}, subject_phases: record.subject_phases || {}, plan_tasks: record.plan_tasks || [], task_progress });
  }

  function checkRevision(record, payload) {
    if (!payload || !Number.isSafeInteger(payload.revision) || payload.revision < 1 || payload.revision !== record.revision || payload.date !== record.current.date) throw new StoreError('内容已在另一个页面更新，请刷新后再试。', 409);
    if (record.revision >= Number.MAX_SAFE_INTEGER) throw new StoreError('记录版本已达上限，请导出备份。');
  }

  function historyQuery(search) {
    const params = new URLSearchParams(search);
    const subjectId = params.get('subject_id') || '';
    const chapterId = params.get('chapter_id') || '';
    const status = params.get('status') || '';
    const mode = params.get('task_mode') || '';
    const actual = params.get('actual') || '';
    const query = (params.get('q') || '').trim();
    if (subjectId && !isSubjectId(subjectId)) throw new StoreError('请选择有效的学科。');
    if (chapterId.length > 200) throw new StoreError('章节筛选条件无效。');
    if (!['', 'done', 'pending'].includes(status) || !['', 'single-day', 'multi-day'].includes(mode) ||
        !['', 'recorded', 'unrecorded'].includes(actual)) throw new StoreError('请选择有效的记录筛选条件。');
    if (query.length > 120) throw new StoreError('关键词最多填写 120 个字符。');
    const pageNumber = (key, fallback, minimum, maximum) => {
      const raw = params.get(key);
      if (!raw) return fallback;
      const value = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new StoreError('查询分页参数不正确。');
      return value;
    };
    return {
      subjectId, chapterId, status, mode, actual,
      words: query.toLowerCase().split(/\s+/).filter(Boolean),
      limit: pageNumber('limit', 20, 1, 100), offset: pageNumber('offset', 0, 0, Number.MAX_SAFE_INTEGER),
    };
  }

  function searchHistory(record, filters) {
    const { subjectId, chapterId, status, mode, actual, words, limit, offset } = filters;
    const time = studyTime();
    const days = record.archives.filter(day => day.date < record.current.date && day.assignments.some(task => task.done === true));
    days.sort((a, b) => b.date.localeCompare(a.date));
    if (record.current.assignments.length) days.unshift(record.current);
    const dates = [];
    const subjectNames = new Map(record.plan_library?.subjects.map(subject => [subject.id, subject.name]));
    const subjects = new Map();
    const chapters = new Map();
    let total = 0;
    for (const day of days) {
      const onPage = total >= offset && dates.length < limit;
      const assignments = [];
      let hasMatch = false;
      for (const task of day.assignments) {
        const done = task.done === true;
        if (day !== record.current && !done) continue;
        if (!subjects.has(task.subject_id)) {
          const name = subjectNames.get(task.subject_id) || task.subject_name || subjectName(null, task.subject_id) || task.subject_id;
          subjects.set(task.subject_id, { id: task.subject_id, name });
        }
        if (subjectId && task.subject_id !== subjectId) continue;
        if (task.chapter_id) {
          const key = `${task.subject_id}:${task.chapter_id}`;
          if (!chapters.has(key)) chapters.set(key, { id: task.chapter_id, subject_id: task.subject_id, title: task.chapter_title || task.chapter_id });
        }
        if (hasMatch && !onPage) continue;
        if (chapterId && task.chapter_id !== chapterId) continue;
        if (status && done !== (status === 'done')) continue;
        const taskMode = (day === record.current ? record.task_modes?.[task.task_id] : null) || task.task_mode || 'single-day';
        if (mode && taskMode !== mode) continue;
        if (actual && (!done || time.validMinutes(task.actual_minutes) !== (actual === 'recorded'))) continue;
        if (words.length) {
          const text = [task.title, task.detail, task.chapter_title, task.section_name, task.remarks, task.reference].join(' ').toLowerCase();
          if (!words.every(word => text.includes(word))) continue;
        }
        hasMatch = true;
        if (onPage) assignments.push(taskMode === task.task_mode ? task : { ...task, task_mode: taskMode });
      }
      if (!hasMatch) continue;
      if (onPage) {
        dates.push({
          date: day.date, total: assignments.length, completed: assignments.filter(task => task.done === true).length,
          actual_minutes: time.summarizeActual(assignments).actualMinutes, assignments,
        });
      }
      total += 1;
    }
    return { dates: copy(dates), total, offset, limit, subjects: [...subjects.values()], chapters: [...chapters.values()] };
  }

  function deletePlanContent(record, payload, source) {
    checkRevision(record, payload);
    const byChapter = Object.hasOwn(payload, 'chapter_id');
    const byPhase = Object.hasOwn(payload, 'phase');
    const byTask = Object.hasOwn(payload, 'task_id');
    const hasSubject = Object.hasOwn(payload, 'subject_id');
    if ((byTask && (byChapter || byPhase || hasSubject)) || (!byTask && (!hasSubject || (byChapter && byPhase)))) {
      throw new StoreError('请选择要删除的学科、大章、章节或任务。');
    }
    const catalogue = copy(source.library);
    const days = [record.current, ...record.archives];
    const deletedIds = new Set();
    let deletedSubjectId = null;
    let chapterScope = null;
    if (byChapter || byPhase) {
      const subject = planSubject(catalogue, payload.subject_id);
      if (byPhase && !source.index.subjectPhases.get(subject.id).has(payload.phase)) throw new StoreError('这个大章已不存在。');
      const chapters = subject.chapters.filter(item => byPhase ? item.phase === payload.phase : item.id === payload.chapter_id);
      if (byChapter && !chapters.length) throw new StoreError('这个章节已不存在。');
      if (byChapter) preserveEmptyParent(subject, chapters[0]);
      const chapterIds = new Set(chapters.map(chapter => chapter.id));
      chapterScope = { ids: chapterIds, subjectId: subject.id };
      for (const chapter of chapters) for (const task of chapter.tasks) deletedIds.add(task.id);
      subject.chapters = subject.chapters.filter(chapter => !chapterIds.has(chapter.id));
      if (byPhase) {
        if (subject.phases) subject.phases = subject.phases.filter(phase => phase !== payload.phase);
        const remainingChapterIds = new Set(subject.chapters.map(chapter => chapter.id));
        for (const task of source.index.retired.values()) {
          if (task.subject_id !== subject.id || task.phase !== payload.phase) continue;
          deletedIds.add(task.id);
          if (task.chapter_id && !remainingChapterIds.has(task.chapter_id)) chapterIds.add(task.chapter_id);
        }
      }
    } else if (byTask) {
      const entry = source.index.get(payload.task_id);
      if (!entry) throw new StoreError('这项任务已不存在。');
      const subject = planSubject(catalogue, entry.subject.id);
      const chapter = subject.chapters.find(item => item.id === entry.chapter.id);
      deletedIds.add(payload.task_id);
      chapter.tasks = chapter.tasks.filter(task => !deletedIds.has(task.id));
    } else {
      const subject = planSubject(catalogue, payload.subject_id);
      deletedSubjectId = subject.id;
      catalogue.subjects = catalogue.subjects.filter(item => item !== subject);
      for (const chapter of subject.chapters) for (const task of chapter.tasks) deletedIds.add(task.id);
      const metadata = catalogue.metadata;
      if (metadata) {
        if (Object.hasOwn(metadata, 'subject_count')) metadata.subject_count = catalogue.subjects.length;
        if (Object.hasOwn(metadata, 'chapter_count')) metadata.chapter_count = catalogue.subjects.reduce((sum, item) => sum + item.chapters.length, 0);
        if (Object.hasOwn(metadata, 'task_count')) metadata.task_count = source.index.size - subject.chapters.reduce((sum, chapter) => sum + chapter.tasks.length, 0);
        for (const bySubject of [metadata.phase_aliases, metadata.counts, metadata.estimates?.by_subject, metadata.round_two_exercises?.by_subject]) {
          if (bySubject) delete bySubject[subject.id];
        }
      }
    }

    const matchesDeletedScope = task => (deletedSubjectId !== null && task.subject_id === deletedSubjectId) ||
      (chapterScope !== null && task.subject_id === chapterScope.subjectId && chapterScope.ids.has(task.chapter_id));
    if (deletedSubjectId || chapterScope) {
      for (const task of source.index.retired.values()) if (matchesDeletedScope(task)) deletedIds.add(task.id);
      const addOrphan = task => {
        if (matchesDeletedScope(task) && !source.index.has(task.task_id) && !source.index.retired.has(task.task_id)) deletedIds.add(task.task_id);
      };
      (record.plan_tasks || []).forEach(addOrphan);
      for (const day of days) day.assignments.forEach(addOrphan);
    }

    const subject_phases = Object.fromEntries(Object.entries(record.subject_phases || {}).flatMap(([id, phase]) => {
      const subject = catalogue.subjects.find(item => item.id === id);
      if (!subject) return [];
      const phaseExists = subject.phases?.includes(phase) || subject.chapters.some(chapter => chapter.phase === phase);
      return [[id, phaseExists ? phase : '']];
    }));
    const next = { ...record, revision: record.revision + 1, plan_library: catalogue, plan_customized: true, subject_phases };

    const affectedSubjects = new Set();
    const affectedTaskIds = new Set(deletedIds);
    const removesAssignment = task => deletedIds.has(task.task_id) || matchesDeletedScope(task);
    if (deletedSubjectId) affectedSubjects.add(deletedSubjectId);
    for (const day of days) {
      for (const task of day.assignments) if (removesAssignment(task)) {
        affectedSubjects.add(task.subject_id);
        affectedTaskIds.add(task.task_id);
      }
    }
    if (!affectedTaskIds.size && !deletedSubjectId && !byPhase) return next;
    for (const id of affectedTaskIds) {
      const entry = source.index.get(id);
      if (!entry) continue;
      const { task, subject } = entry;
      affectedSubjects.add(subject.id);
      for (const relatedId of source.index.groups.get(task.estimate_group || id) || []) {
        affectedSubjects.add(source.index.get(relatedId).subject.id);
      }
    }
    if (deletedIds.size) {
      if (catalogue.metadata?.retired_tasks) {
        catalogue.metadata.retired_tasks = catalogue.metadata.retired_tasks.filter(task => !deletedIds.has(task.id));
      }
      for (const subject of catalogue.subjects) {
        for (const section of Object.values(subject.sections || {})) {
          if (Array.isArray(section.learning_tasks)) section.learning_tasks = section.learning_tasks.filter(id => !deletedIds.has(id));
        }
      }
    }

    const cleanDay = day => {
      const assignments = day.assignments.filter(task => !removesAssignment(task));
      const frozen = day.subject_stage_progress;
      if (!frozen) return { ...day, assignments };
      const subject_stage_progress = Object.fromEntries(Object.entries(frozen).filter(([id, progress]) => {
        if (byPhase && id === chapterScope.subjectId) {
          if (progress.phase === payload.phase) return false;
          if (progress.phase) return !day.assignments.some(task => task.subject_id === id &&
            deletedIds.has(task.task_id) && !matchesDeletedScope(task));
        }
        return !affectedSubjects.has(id);
      }));
      return { ...day, assignments, subject_stage_progress };
    };
    const archives = record.archives.flatMap(day => {
      const cleaned = cleanDay(day);
      return day.assignments.length && !cleaned.assignments.length ? [] : [cleaned];
    });
    return {
      ...next,
      current: cleanDay(record.current),
      archives,
      library_completed_ids: (record.library_completed_ids || []).filter(id => !deletedIds.has(id)),
      library_reopened_ids: (record.library_reopened_ids || []).filter(id => !deletedIds.has(id)),
      task_modes: Object.fromEntries(Object.entries(record.task_modes || {}).filter(([id]) => !deletedIds.has(id))),
      plan_tasks: (record.plan_tasks || []).filter(task => !removesAssignment(task)),
    };
  }

  function subjectStageProgress(record, index, historicalDay = null) {
    let source = record;
    if (historicalDay) {
      const archives = record.archives.filter(day => day.date < historicalDay.date);
      const modes = {}, marked = new Set();
      for (const day of [...archives, historicalDay].sort((a, b) => a.date.localeCompare(b.date))) for (const task of day.assignments) {
        modes[task.task_id] = task.task_mode || index.get(task.task_id)?.task.task_mode || 'single-day';
        if (modes[task.task_id] === 'multi-day') {
          if (task.overall_completed) marked.add(task.task_id);
          else marked.delete(task.task_id);
        }
      }
      source = { ...record, current: historicalDay, archives, task_modes: modes, library_completed_ids: [...marked], library_reopened_ids: [] };
    }
    const view = stateOf(source);
    const modeOf = task => view.task_modes[task.task_id || task.id] || task.task_mode || index.get(task.task_id || task.id)?.task.task_mode || 'single-day';
    const context = { completed: new Set(view.completed_ids), marked: new Set(view.library_completed_ids), reopened: new Set(view.library_reopened_ids), byId: new Map(view.assignments.map(task => [task.task_id, task])), modeOf };
    const isCompleted = task => models().taskCompleted(index.groups.get(task.estimate_group || task.id) || [task.id], modeOf(task), context);
    return Object.fromEntries([...index.subjectModels].map(([id, subject]) => {
      const firstTask = historicalDay?.assignments.find(task => task.subject_id === id);
      const phase = historicalDay ? index.get(firstTask?.task_id)?.chapter.phase : view.subject_phases[id];
      return [id, subject.stageProgress({ phase, selectedIds: view.assignments.filter(task => task.subject_id === id).map(task => task.task_id), isCompleted })];
    }));
  }

  function normaliseStageProgress(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoreError('归档阶段进度不正确。');
    return Object.fromEntries(Object.entries(value).map(([id, entry]) => {
      if (!isSubjectId(id) || !entry || typeof entry.phase !== 'string' || entry.phase.length > 200 ||
          !Number.isFinite(entry.totalMinutes) || entry.totalMinutes < 0 || entry.totalMinutes > 1e12 ||
          !Number.isFinite(entry.completedMinutes) || entry.completedMinutes < 0 || entry.completedMinutes > entry.totalMinutes ||
          !Number.isSafeInteger(entry.unknown) || entry.unknown < 0 || entry.unknown > 100000) throw new StoreError('归档阶段进度不正确。');
      return [id, { phase: entry.phase, totalMinutes: entry.totalMinutes, completedMinutes: entry.completedMinutes, unknown: entry.unknown, percent: entry.totalMinutes > 0 ? entry.completedMinutes / entry.totalMinutes * 100 : null }];
    }));
  }

  function saveRecord(record, payload, index) {
    checkRevision(record, payload);
    const assignments = normaliseAssignments(payload.assignments, index, {
      preserveSnapshots: true, limit: Math.max(MAX_TASKS, record.current.assignments.length),
    });
    const markers = {};
    for (const key of ['library_completed_ids', 'library_reopened_ids']) if (Object.hasOwn(payload, key)) markers[key] = normaliseLibraryCompletedIds(payload[key], index);
    if (Object.hasOwn(payload, 'task_modes')) markers.task_modes = normaliseTaskModes(payload.task_modes, index);
    if (Object.hasOwn(payload, 'subject_phases')) markers.subject_phases = normaliseSubjectPhases(payload.subject_phases, index);
    if (Object.hasOwn(payload, 'plan_tasks')) markers.plan_tasks = normalisePlan(payload.plan_tasks, index);
    return { ...record, ...markers, revision: record.revision + 1, current: { date: record.current.date, assignments } };
  }

  function multiDayCompletion(record, index) {
    const finished = new Set(record.library_completed_ids || []);
    const reopened = new Set(record.library_reopened_ids || []);
    return task => {
      const group = index?.get(task.task_id)?.task.estimate_group || task.task_id;
      const ids = index?.groups?.get(group) || [task.task_id];
      return !ids.some(id => reopened.has(id)) && ids.some(id => finished.has(id));
    };
  }

  function archivedDay(record, index, isMultiDayFinished) {
    const assignments = record.current.assignments.filter(task => task.done === true).map(task => {
      const task_mode = record.task_modes?.[task.task_id] || task.task_mode || 'single-day';
      const snapshot = { ...task, task_mode };
      if (task_mode === 'multi-day') snapshot.overall_completed = isMultiDayFinished(task);
      else delete snapshot.overall_completed;
      return snapshot;
    });
    if (!assignments.length) return null;
    return { ...record.current, assignments, ...(index ? { subject_stage_progress: subjectStageProgress(record, index) } : {}) };
  }

  function unfinishedAssignments(record, isMultiDayFinished) {
    return record.current.assignments.flatMap(task => {
      const task_mode = record.task_modes?.[task.task_id] || task.task_mode || 'single-day';
      if (task_mode === 'multi-day') {
        if (isMultiDayFinished(task)) return [];
        const { overall_completed, ...pending } = task;
        return [{ ...pending, task_mode, done: false, actual_minutes: null, checkin_segments: [] }];
      }
      return task.done ? [] : [{ ...task, task_mode }];
    });
  }

  function archiveRecord(record, payload, index = null) {
    checkRevision(record, payload);
    if ('carry_pending' in payload && typeof payload.carry_pending !== 'boolean') throw new StoreError('未完成任务的保留选项不正确。');
    return alignDate(record, nextDate(record.current.date), index, payload.carry_pending !== false);
  }

  function alignDate(record, today, index, carryPending = true) {
    if (record.current.date === today) return record;
    const savedToday = record.archives.find(day => day.date === today);
    const archives = record.archives.filter(day => day.date !== today && day.date !== record.current.date);
    const forward = record.current.date < today;
    const isMultiDayFinished = multiDayCompletion(record, index);
    const previous = forward ? archivedDay(record, index, isMultiDayFinished) : record.current;
    if (previous) archives.push(previous);
    const scheduled = savedToday?.assignments || [];
    const scheduledIds = new Set(scheduled.map(task => task.task_id));
    const carried = forward && carryPending ? unfinishedAssignments(record, isMultiDayFinished).filter(task => !scheduledIds.has(task.task_id)) : [];
    // Existing scheduled tasks and carried work both survive the rollover, even above the manual selection limit.
    const assignments = carried.length ? mergeTasks(scheduled, carried, index, Infinity) : scheduled;
    return { ...record, revision: record.revision + 1, current: { date: today, assignments }, archives };
  }

  const studyDateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  const studyDate = (now = new Date()) => studyDateFormat.format(now);

  const isBackupFile = value => value?.format === BACKUP_FORMAT;
  const isFullBackup = value => isBackupFile(value) && value.version === FULL_BACKUP_VERSION;

  function validateBackup(value, index) {
    const full = isFullBackup(value);
    if (!isBackupFile(value) || (!full && value.version !== 1) || !value.current || !Array.isArray(value.archives) || value.archives.length > MAX_ARCHIVES) throw new StoreError('请选择学习手账导出的完整 JSON 备份。');
    if (full && (!value.plan_library || typeof value.plan_customized !== 'boolean')) throw new StoreError('完整备份缺少学习计划。');
    if (full && !['library_completed_ids', 'library_reopened_ids', 'task_modes', 'subject_phases', 'plan_tasks'].every(key => Object.hasOwn(value, key))) throw new StoreError('完整备份缺少打卡状态或任务设置。');
    const plan_library = value.plan_library ? validateCatalogue(value.plan_library) : null;
    if (plan_library) index = libraryIndex(plan_library);
    const day = (entry) => {
      if (!entry || typeof entry !== 'object') throw new StoreError('备份中的日期记录不正确。');
      const assignments = normaliseAssignments(entry.assignments, index, { preserveSnapshots: true, preserveOrder: full, limit: full ? Infinity : MAX_TASKS });
      return { date: validateDate(entry.date), assignments, ...(entry.subject_stage_progress ? { subject_stage_progress: normaliseStageProgress(entry.subject_stage_progress) } : {}) };
    };
    const current = day(value.current);
    const dates = new Set();
    const archives = value.archives.map((entry) => {
      const result = day(entry);
      if (dates.has(result.date) || result.date === current.date) throw new StoreError('备份含有重复日期，请检查后再导入。');
      dates.add(result.date);
      return result;
    });
    const library_completed_ids = Object.hasOwn(value, 'library_completed_ids') ? normaliseLibraryCompletedIds(value.library_completed_ids, index) : [];
    const library_reopened_ids = Object.hasOwn(value, 'library_reopened_ids') ? normaliseLibraryCompletedIds(value.library_reopened_ids, index) : [];
    const task_modes = Object.hasOwn(value, 'task_modes') ? normaliseTaskModes(value.task_modes, index) : {};
    const subject_phases = Object.hasOwn(value, 'subject_phases') ? normaliseSubjectPhases(value.subject_phases, index) : {};
    const plan_tasks = Object.hasOwn(value, 'plan_tasks') ? normalisePlan(value.plan_tasks, index) : [];
    return { current, archives, library_completed_ids, library_reopened_ids, task_modes, subject_phases, plan_tasks, ...(plan_library ? { plan_library, plan_customized: Boolean(value.plan_customized) } : {}) };
  }

  function packBackup(record) {
    return {
      format: BACKUP_FORMAT, version: FULL_BACKUP_VERSION, exported_at: new Date().toISOString(),
      ...copy({
        plan_library: record.plan_library, plan_customized: Boolean(record.plan_customized),
        current: record.current, archives: record.archives,
        library_completed_ids: record.library_completed_ids || [], library_reopened_ids: record.library_reopened_ids || [],
        task_modes: record.task_modes || {}, subject_phases: record.subject_phases || {}, plan_tasks: record.plan_tasks || [],
      }),
    };
  }

  function mergeTasks(existing, incoming, index, limit = MAX_TASKS) {
    const result = existing.map((item) => ({ ...item }));
    const map = new Map(result.map((item) => [item.task_id, item]));
    for (const task of incoming) {
      const previous = map.get(task.task_id);
      if (previous) {
        const completedBefore = previous.done;
        previous.done = previous.done || task.done;
        if (!completedBefore && task.done) previous.actual_minutes = task.actual_minutes ?? null;
        else if (previous.actual_minutes == null && task.done && task.actual_minutes != null) previous.actual_minutes = task.actual_minutes;
        if (!previous.done) previous.actual_minutes = null;
        if (task.checkin_segments && previous.done && previous.actual_minutes === task.actual_minutes && (!completedBefore || !previous.checkin_segments?.length)) previous.checkin_segments = [...task.checkin_segments];
        if (previous.done && previous.checkin_segments && Math.abs(models().sumSegments(previous.checkin_segments) - previous.actual_minutes) > 1e-7) delete previous.checkin_segments;
      }
      else { const added = { ...task }; map.set(task.task_id, added); result.push(added); }
    }
    if (result.length > Math.max(limit, existing.length, incoming.length)) throw new StoreError('合并后某一天超过 100 项任务，未导入任何内容。请先整理备份。');
    return result.sort((a, b) => compareSubjects(index, a.subject_id, b.subject_id));
  }

  function hasStudyContent(record) {
    return Boolean(record.current.assignments.length || record.archives.length || record.plan_customized || record.plan_tasks?.length || record.library_completed_ids?.length ||
      record.library_reopened_ids?.length || Object.keys(record.task_modes || {}).length || Object.keys(record.subject_phases || {}).length);
  }

  function importRecord(record, incoming, options = {}) {
    if (!Number.isSafeInteger(options.revision) || options.revision !== record.revision || record.revision >= Number.MAX_SAFE_INTEGER) throw new StoreError('内容已在另一个页面更新，请刷新后再导入。', 409);
    if ('replace' in options && typeof options.replace !== 'boolean') throw new StoreError('备份导入选项不正确。');
    const existingMarkers = Array.isArray(record.library_completed_ids) ? record.library_completed_ids : [];
    const incomingMarkers = Array.isArray(incoming.library_completed_ids) ? incoming.library_completed_ids : [];
    const existingReopened = Array.isArray(record.library_reopened_ids) ? record.library_reopened_ids : [];
    const incomingReopened = Array.isArray(incoming.library_reopened_ids) ? incoming.library_reopened_ids : [];
    if (options.replace || !hasStudyContent(record)) return { ...record, revision: record.revision + 1, ...copy(incoming), task_modes: copy(incoming.task_modes || {}), library_completed_ids: [...incomingMarkers], library_reopened_ids: [...incomingReopened] };
    const merged = new Map(record.archives.map((day) => [day.date, copy(day)]));
    const current = copy(record.current);
    for (const day of [...incoming.archives, incoming.current]) {
      if (day.date === current.date) current.assignments = mergeTasks(current.assignments, day.assignments);
      else {
        const previous = merged.get(day.date);
        const progress = previous?.subject_stage_progress || day.subject_stage_progress;
        merged.set(day.date, { date: day.date, assignments: previous ? mergeTasks(previous.assignments, day.assignments) : copy(day.assignments), ...(progress ? { subject_stage_progress: copy(progress) } : {}) });
      }
    }
    let catalogue = record.plan_library;
    if (incoming.plan_library) catalogue = catalogue ? mergeCatalogues(catalogue, incoming.plan_library) : incoming.plan_library;
    if (catalogue) {
      const ids = new Set(planEntries(catalogue).map(task => task.task_id));
      catalogue = copy(catalogue);
      for (const task of incoming.plan_tasks || []) if (!ids.has(task.task_id)) putPlanTask(catalogue, task);
    }
    return { ...copy(record), ...(catalogue ? { plan_library: catalogue, plan_customized: Boolean(record.plan_customized || incoming.plan_customized) } : {}), plan_tasks: mergePlans(record.plan_tasks || [], incoming.plan_tasks || [], catalogue ? libraryIndex(catalogue) : undefined), subject_phases: { ...(incoming.subject_phases || {}), ...(record.subject_phases || {}) }, task_modes: { ...(incoming.task_modes || {}), ...(record.task_modes || {}) }, revision: record.revision + 1, current, archives: [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)), library_completed_ids: [...new Set([...existingMarkers, ...incomingMarkers.filter((id) => !existingReopened.includes(id))])].sort(), library_reopened_ids: [...new Set([...existingReopened, ...incomingReopened.filter((id) => !existingMarkers.includes(id))])].sort() };
  }

  function storageError(error) {
    if (error instanceof StoreError) return error;
    if (error?.name === 'QuotaExceededError') return new StoreError('浏览器存储空间不足，学习记录尚未保存。请先导出备份，再释放空间。', 507);
    if (error?.name === 'SecurityError' || error?.name === 'NotAllowedError') return new StoreError('浏览器禁止保存本站数据，请允许此网站使用本地存储后重试。', 503);
    return new StoreError('浏览器中的学习记录暂时无法读写，请导出备份或重新载入后重试。', 503);
  }

  function createStore(env = root, remoteTransact = null, scope = '') {
    const href = env.location?.href || 'https://example.invalid/';
    const dbName = namespace(href) + scope;
    const scriptSource = env.document?.currentScript?.src || env.document?.querySelector?.('script[src*="storage.js"]')?.src;
    const assetVersion = scriptSource ? new URL(scriptSource, href).searchParams.get('v') : null;
    let libraryPromise;
    let dbPromise;
    let channel;
    const subscribers = new Set();
    let catalogueSource;
    let catalogueCache;
    const today = () => studyDate(env.now ? env.now() : new Date());

    function loadLibrary() {
      if (!libraryPromise) libraryPromise = (async () => {
        try {
          const libraryUrl = new URL('data/library.json', href);
          if (assetVersion) libraryUrl.searchParams.set('v', assetVersion);
          const response = await env.fetch(libraryUrl.href, { cache: assetVersion ? 'force-cache' : 'no-cache' });
          if (!response.ok) throw new Error('library unavailable');
          const value = await response.json();
          return { library: freezeLibrary(value), index: libraryIndex(value) };
        } catch (error) {
          libraryPromise = null;
          if (error instanceof StoreError) throw error;
          throw new StoreError('章节任务库暂时无法载入，请检查网络后重试。', 503);
        }
      })();
      return libraryPromise;
    }

    function recordLibrary(record, fallback) {
      if (!record.plan_library || record.plan_library === fallback?.library) return fallback;
      const source = JSON.stringify(record.plan_library);
      if (source !== catalogueSource) {
        const library = freezeLibrary(copy(record.plan_library));
        catalogueCache = { library, index: libraryIndex(library) };
        catalogueSource = source;
      }
      return catalogueCache;
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

    async function transact(operation, readOnly = false) {
      if (remoteTransact) return remoteTransact(operation, readOnly);
      const db = await openDb();
      return new Promise((resolve, reject) => {
        let transaction;
        let result;
        let changedRevision;
        let operationError;
        try {
          transaction = db.transaction('records', readOnly ? 'readonly' : 'readwrite');
          const store = transaction.objectStore('records');
          const request = store.get('main');
          request.onsuccess = () => {
            try {
              const previous = request.result || initialRecord(today());
              const outcome = operation(previous);
              result = outcome.result;
              if (outcome.record || (!readOnly && !request.result)) store.put(outcome.record || previous, 'main');
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

    async function withLibraryFallback(operation, readOnly = false) {
      const result = await transact(operation, readOnly);
      if (result !== null) return result;
      const base = await loadLibrary().catch(error => ({ error }));
      return transact(record => operation(record, base), readOnly);
    }

    async function request(path, options = {}) {
      const method = (options.method || 'GET').toUpperCase();
      if (method === 'GET' && (path === '/api/history' || path.startsWith('/api/history?'))) {
        const filters = historyQuery(path.slice('/api/history?'.length));
        return transact(record => ({ result: searchHistory(record, filters) }), true);
      }
      if (method === 'GET' && ['/api/library', '/api/state', '/api/day'].includes(path)) {
        const read = (record, base) => {
          const refresh = !record.plan_customized && record.plan_library?.version < DEFAULT_PLAN_VERSION && env.navigator?.onLine !== false;
          if (!base && (!record.plan_library || refresh)) return { result: null };
          if (!record.plan_library && base.error) throw base.error;
          let migrated = record;
          if (!record.plan_library) migrated = migratePlan(base.library, record);
          else if (refresh && base?.library?.version > record.plan_library.version) {
            const aligned = path === '/api/library' || record.current.date === today() ? record : alignDate(record, today(), recordLibrary(record).index);
            migrated = { ...refreshDefaultPlan(base, aligned), revision: record.revision + 1 };
          }
          const { library, index } = recordLibrary(migrated, base);
          if (path === '/api/library') return { ...(migrated === record ? {} : { record: migrated }), result: library };
          const hydrated = hydrateRecordEstimates(migrated, index);
          const aligned = alignDate(hydrated, today(), index);
          const next = aligned === record ? record : { ...aligned, revision: record.revision + 1 };
          const state = stateOf(next);
          return { ...(next === record ? {} : { record: next }), result: path === '/api/day' ? { library, state } : state };
        };
        return withLibraryFallback(read);
      }
      let payload;
      if (options.body !== undefined) {
        try { payload = JSON.parse(options.body); } catch { throw new StoreError('保存的内容格式不正确。'); }
      }
      if (path === '/api/state' && method === 'PUT') {
        return withLibraryFallback((record, base) => {
          if (!record.plan_library && !base) return { result: null };
          if (!record.plan_library && base.error) throw base.error;
          const next = saveRecord(record, payload, recordLibrary(record, base).index);
          return { record: next, result: stateOf(next) };
        });
      }
      if (path === '/api/plan' && method === 'PUT') {
        const catalogue = validateCatalogue(payload?.catalogue);
        return transact(record => {
          checkRevision(record, payload);
          const previous = record.plan_library;
          // Removed tasks remain registered so old check-ins and completion markers retain their IDs.
          if (previous) {
            const index = libraryIndex(catalogue);
            const previousNames = new Map(previous.subjects.map(subject => [subject.id, subject.name]));
            catalogue.metadata ||= {};
            catalogue.metadata.retired_tasks ||= [];
            for (const task of planEntries(previous)) if (!index.has(task.task_id) && !index.retired.has(task.task_id)) {
              catalogue.metadata.retired_tasks.push({ ...task, id: task.task_id, subject_name: previousNames.get(task.subject_id) });
            }
            const retired = new Map(catalogue.metadata.retired_tasks.map(task => [task.id, task]));
            for (const task of previous.metadata?.retired_tasks || []) if (!index.has(task.id) && !retired.has(task.id)) retired.set(task.id, task);
            catalogue.metadata.retired_tasks = [...retired.values()];
          }
          const index = libraryIndex(catalogue);
          const phases = Object.fromEntries(Object.entries(record.subject_phases || {}).flatMap(([id, phase]) =>
            index.subjects.has(id) ? [[id, index.subjectPhases.get(id).has(phase) ? phase : '']] : []));
          const next = { ...record, plan_library: catalogue, plan_customized: true, plan_tasks: [], subject_phases: phases, revision: record.revision + 1 };
          if (Object.hasOwn(payload, 'mode_task_id')) {
            const id = payload.mode_task_id;
            const task = index.get(id)?.task;
            if (!task) throw new StoreError('找不到要设置类别的计划任务。');
            next.task_modes = { ...record.task_modes };
            delete next.task_modes[id];
            next.current = { ...record.current, assignments: record.current.assignments.map(assignment =>
              assignment.task_id === id ? { ...assignment, task_mode: task.task_mode || 'single-day' } : assignment) };
          }
          return { record: next, result: stateOf(next) };
        });
      }
      if (path === '/api/plan' && method === 'DELETE') {
        return transact(record => {
          if (!record.plan_library) throw new StoreError('请重新打开学习计划后再删除。', 409);
          const next = deletePlanContent(record, payload, recordLibrary(record));
          return { record: next, result: stateOf(next) };
        });
      }
      if (path.startsWith('/api/history/') && method === 'GET') {
        let date;
        try { date = decodeURIComponent(path.slice('/api/history/'.length)); } catch { throw new StoreError('历史日期不正确。'); }
        validateDate(date);
        return withLibraryFallback((record, base) => {
          const saved = date < record.current.date && record.archives.find(item => item.date === date);
          const assignments = saved ? saved.assignments.filter(task => task.done === true) : [];
          if (!assignments.length) throw new StoreError('没有找到这一天的打卡记录。', 404);
          const day = { ...saved, assignments };
          const frozen = day.subject_stage_progress;
          if (frozen && day.assignments.every(task => Object.hasOwn(frozen, task.subject_id))) return { result: copy(day) };
          if (!record.plan_library && !base) return { result: null };
          if (!record.plan_library && base.error) throw base.error;
          const subject_stage_progress = subjectStageProgress(record, recordLibrary(record, base).index, day);
          return { result: copy({ ...day, subject_stage_progress: { ...subject_stage_progress, ...frozen } }) };
        }, true);
      }
      throw new StoreError('操作不存在。', 404);
    }

    async function exportBackup() {
      const record = await transact(record => ({ result: record }), true);
      if (record.plan_library) return packBackup(record);
      const base = await loadLibrary();
      return packBackup(migratePlan(base.library, record));
    }

    async function prepareBackup(value) {
      const base = isBackupFile(value) && value.version === 1 && !value.plan_library ? await loadLibrary() : null;
      const incoming = validateBackup(value, base?.index);
      if (!incoming.plan_library) {
        incoming.plan_library = migratePlan(base.library, { ...incoming, revision: 1 }).plan_library;
        incoming.plan_customized = false;
      }
      return incoming;
    }

    async function importBackup(value, options = {}) {
      const incoming = await prepareBackup(value);
      const full = isFullBackup(value);
      if (full && options.replace && incoming.plan_library.version < DEFAULT_PLAN_VERSION) incoming.plan_customized = true;
      return transact((record) => {
        const imported = importRecord(record, incoming, options);
        const next = { ...alignDate(imported, today(), recordLibrary(imported).index), revision: imported.revision };
        return { record: next, result: stateOf(next) };
      });
    }

    async function importLocalOnce(backup) {
      if (!hasStudyContent(backup)) return;
      const incoming = await prepareBackup(backup);
      return transact((record) => {
        if (record.local_imported) return {};
        const next = importRecord(record, incoming, { revision: record.revision });
        return { record: { ...next, local_imported: true } };
      });
    }

    return { request, exportBackup, importBackup, importLocalOnce, transact, subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); }, async close() { const db = dbPromise ? await dbPromise : null; db?.close(); dbPromise = null; channel?.close(); channel = null; }, databaseName: dbName };
  }

  const api = createStore();
  api.createStore = createStore;
  api.StoreError = StoreError;
  api.MAX_TASKS = MAX_TASKS;
  api.backup = Object.freeze({ isFile: isBackupFile, isFull: isFullBackup });
  api.plan = Object.freeze({
    entries: planEntries,
    update: updatePlan,
    remove: removePlanTask,
    updateSubject: updatePlanSubject,
    addPhase: addPlanPhase,
    updateChapter: updatePlanChapter,
    merge: mergeCatalogues,
    pack: catalogue => ({ format: PLAN_FORMAT, version: 2, catalogue: validateCatalogue(catalogue) }),
    unpack(value, base) {
      if (Array.isArray(value?.subjects)) return validateCatalogue(value);
      if (value?.format !== PLAN_FORMAT) throw new StoreError('请选择从学习计划导出的 JSON 文件。');
      if (value.version === 2) return validateCatalogue(value.catalogue);
      if (value.version === 1 && base) {
        const catalogue = copy(base);
        const index = libraryIndex(catalogue);
        for (const [id, name] of Object.entries(SUBJECTS)) if (!index.subjects.has(id)) index.subjects.set(id, { id, name, chapters: [] });
        for (const task of normalisePlan(value.tasks, index)) {
          if (!catalogue.subjects.some(subject => subject.id === task.subject_id)) catalogue.subjects.push(index.subjects.get(task.subject_id));
          putPlanTask(catalogue, task);
        }
        return validateCatalogue(catalogue);
      }
      throw new StoreError('不支持这个计划文件的版本。');
    },
  });
  api.studyDate = studyDate;
  api.helpers = Object.freeze({ validateDate, nextDate, localDate, namespace, libraryIndex, normaliseAssignments, normaliseLibraryCompletedIds, initialRecord, hydrateRecordEstimates, stateOf, subjectStageProgress, saveRecord, archiveRecord, validateBackup, mergeTasks, importRecord, storageError });
  return api;
});
