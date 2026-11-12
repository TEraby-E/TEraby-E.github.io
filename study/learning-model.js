/* Shared subject and subsection metadata, keyed by subsection name. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudyModels = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const computingIds = new Set(['ds', 'co', 'os', 'cn']);

  class StudySubject {
    constructor(data) {
      this.id = data.id;
      this.name = data.name;
      this.chapters = data.chapters || [];
    }
    get supportsLearningInfo() { return false; }
    get phases() { return [...new Set(this.chapters.map(chapter => chapter.phase).filter(Boolean))]; }
    sectionFor() { return null; }
    learningInfo(task) { return learningInfo(task, this.sectionFor(task)); }

    resolvePhase(preferred, isCompleted = () => false, selectedIds = []) {
      const phases = this.phases;
      if (preferred === '' || phases.includes(preferred)) return preferred;
      const selected = new Set(selectedIds);
      const selectedPhase = this.chapters.find(chapter => chapter.tasks.some(task => selected.has(task.id)))?.phase;
      if (selectedPhase) return selectedPhase;
      return this.chapters.find(chapter => chapter.tasks.some(task => !isCompleted(task)))?.phase || phases[0] || '';
    }

    stageProgress({ phase, isCompleted = () => false, selectedIds = [] } = {}) {
      phase = this.resolvePhase(phase, isCompleted, selectedIds);
      const groups = new Map();
      for (const chapter of this.chapters) {
        if (phase && chapter.phase !== phase) continue;
        for (const task of chapter.tasks) {
          const key = task.estimate_group || task.id;
          const group = groups.get(key) || { minutes: null, completed: false };
          const minutes = task.estimated_minutes;
          if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0 && minutes <= 525600) group.minutes = Math.max(group.minutes ?? 0, minutes);
          group.completed ||= Boolean(isCompleted(task));
          groups.set(key, group);
        }
      }
      let totalMinutes = 0, completedMinutes = 0, unknown = 0;
      for (const group of groups.values()) {
        if (group.minutes === null) { unknown += 1; continue; }
        totalMinutes += group.minutes;
        if (group.completed) completedMinutes += group.minutes;
      }
      totalMinutes = Number(totalMinutes.toFixed(8));
      completedMinutes = Math.min(totalMinutes, Number(completedMinutes.toFixed(8)));
      return { phase, totalMinutes, completedMinutes, unknown, percent: totalMinutes > 0 ? completedMinutes / totalMinutes * 100 : null };
    }
  }

  class SectionedSubject extends StudySubject {
    constructor(data) {
      super(data);
      this.sections = data.sections || {};
      this.taskSections = new Map();
      for (const [name, section] of Object.entries(this.sections)) {
        if (!Array.isArray(section?.learning_tasks)) continue;
        for (const id of section.learning_tasks) this.taskSections.set(id, name);
      }
    }
    get supportsLearningInfo() { return true; }
    sectionFor(task) {
      const name = task.section_name || this.taskSections.get(task.task_id || task.id);
      const section = name && Object.hasOwn(this.sections, name) ? this.sections[name] : null;
      return section && typeof section === 'object' && !Array.isArray(section) ? { name, ...section } : null;
    }
  }

  function createSubject(data) {
    return computingIds.has(data.id) || Object.keys(data.sections || {}).length
      ? new SectionedSubject(data) : new StudySubject(data);
  }

  function taskCompleted(ids, mode, context) {
    if (ids.some(id => context.reopened.has(id))) return false;
    if (ids.some(id => context.marked.has(id))) return true;
    if (mode === 'multi-day') return false;
    return ids.some(id => {
      const task = context.byId.get(id);
      return context.completed.has(id) || Boolean(task?.done && (context.modeOf?.(task) || task.task_mode) !== 'multi-day');
    });
  }

  function learningInfo(task, section = null, annotation = splitRemark(task.remarks)) {
    return {
      section_name: task.section_name || section?.name || '',
      difficulty: task.difficulty ?? section?.difficulty ?? annotation.difficulty,
      exam_frequency: { small: task.exam_frequency?.small ?? section?.exam_frequency?.small ?? annotation.exam_frequency.small, large: task.exam_frequency?.large ?? section?.exam_frequency?.large ?? annotation.exam_frequency.large },
      section_estimated_minutes: task.section_estimated_minutes ?? section?.estimated_minutes ?? null,
    };
  }

  const cleanText = value => String(value || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[\t ]+/g, ' ').trim()).filter(Boolean).join('\n').trim();

  function splitRemark(value) {
    const result = { text: cleanText(value), difficulty: null, exam_frequency: { small: null, large: null } };
    result.text = result.text.replace(/(?:章节|章)?考频\s*[：:]\s*小题\s*(\d+)\s*[、,，;；]\s*大题\s*(\d+)/g, (_, small, large) => {
      result.exam_frequency = { small: Number(small), large: Number(large) }; return '';
    });
    for (const [label, key] of [['小题', 'small'], ['大题', 'large']]) {
      result.text = result.text.replace(new RegExp(`${label}\\s*考频\\s*[：:]\\s*(\\d+)`, 'g'), (_, count) => { result.exam_frequency[key] = Number(count); return ''; });
    }
    result.text = result.text.replace(/(?:章节|小节)?难度\s*[：:]\s*([☆★]{1,5})/g, (_, stars) => { result.difficulty = stars.replace(/★/g, '☆'); return ''; });
    result.text = result.text.replace(/[；;]\s*(?:[；;]\s*)+/g, '；').replace(/^[\s；;、,，|｜]+|[\s；;、,，|｜]+$/g, '').trim();
    return result;
  }

  function segmentsOf(task) {
    if (!task.done) return [];
    if (Array.isArray(task.checkin_segments)) return [...task.checkin_segments];
    return typeof task.actual_minutes === 'number' && Number.isFinite(task.actual_minutes) ? [task.actual_minutes] : [];
  }
  function sumSegments(segments) { return Number(segments.reduce((total, minutes) => total + minutes, 0).toFixed(8)); }
  function appendSegment(task, minutes) {
    const segments = segmentsOf(task);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 525600 || segments.length >= 2000) throw new Error('本次用时或学习片段数量超出范围。');
    segments.push(minutes);
    const total = sumSegments(segments);
    if (total > 525600) throw new Error('当天累计用时不能超过 525600 分钟。');
    return { done: true, actual_minutes: total, checkin_segments: segments };
  }

  function defaultActualInput(tasks, { useRecorded = true } = {}) {
    const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 525600;
    const actual = useRecorded ? tasks.filter(task => task.done && valid(task.actual_minutes)).map(task => task.actual_minutes) : [];
    if (actual.length) return String(Math.max(...actual));
    const defaults = tasks.map(task => task.estimated_minutes).filter(valid);
    return defaults.length ? String(Math.max(...defaults)) : '';
  }

  function learningText(value) {
    return cleanText(value).replace(/(?:原表|原图)备注[：:]\s*/g, '').replace(/〔原图[^〕]*〕/g, '').trim();
  }

  class TaskPresentation {
    constructor(task, section = null, { showLearningInfo } = {}) {
      this.task = task;
      this.annotation = splitRemark(task.remarks);
      this.info = learningInfo(task, section, this.annotation);
      const { small, large } = this.info.exam_frequency;
      this.showLearningInfo = showLearningInfo === undefined
        ? Boolean(task.section_name || section || task.difficulty || small != null || large != null)
        : showLearningInfo;
    }
    get title() {
      const title = cleanText(this.task.title);
      return this.showLearningInfo ? title.replace(/[｜|]\s*(?:难度|章考频|小题考频|大题考频)[：:][^｜|]*/g, '').trim() : title;
    }
    get detail() {
      const title = cleanText(this.task.title);
      const detail = learningText(this.task.detail);
      return detail.replace(/\s/g, '') === title.replace(/\s/g, '') ? '' : detail;
    }
    get remarks() {
      const remarks = learningText(this.annotation.text);
      return remarks && remarks !== cleanText(this.task.title) && !this.detail.includes(remarks) ? remarks : '';
    }
    get metadata() {
      const frequency = this.info.exam_frequency;
      const learning = this.showLearningInfo ? [['难度', this.info.difficulty || '未提供'], ['小题考频', frequency.small ?? '未提供'], ['大题考频', frequency.large ?? '未提供']] : [];
      const detail = this.detail;
      return [...learning, ['任务类型', this.task.kind], ['任务量', this.task.quantity]]
        .map(([label, value]) => [label, cleanText(value === 0 ? '0' : value)])
        .filter(([label, value]) => value && !detail.includes(`${label}：${value}`));
    }
    get metadataText() { return this.metadata.map(([label, value]) => `${label}：${value}`).join('  ·  '); }
  }

  return Object.freeze({ StudySubject, SectionedSubject, ComputingSubject: SectionedSubject, TaskPresentation, createSubject, taskCompleted, learningInfo, cleanText, splitRemark, segmentsOf, sumSegments, appendSegment, defaultActualInput });
});
