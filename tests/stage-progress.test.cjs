'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const models = require('../study/learning-model.js');
const time = require('../study/study-time.js');
const store = require('../study/storage.js').helpers;

const ids = ['english','calculus','linear','probability','ds','co','os','cn'];
const names = ['英语','高数','线代','概率论','数据结构','计组','操作系统','计网'];
const raw = { subjects: ids.map((id, i) => ({id, name:names[i], chapters:id !== 'ds' ? [] : [
  {id:'ds-a',title:'第一阶段',phase:'一轮',tasks:[
    {id:'short',title:'短任务',estimated_minutes:10},
    {id:'long',title:'长任务',estimated_minutes:90},
    {id:'multi',title:'多日任务',estimated_minutes:100,task_mode:'multi-day'},
  ]},
  {id:'ds-b',title:'第二阶段',phase:'二轮',tasks:[{id:'next',title:'下阶段任务',estimated_minutes:300}]},
] })) };
const index = store.libraryIndex(raw);
const save = (record, assignments, extras={}) => store.saveRecord(record, {date:record.current.date,revision:record.revision,assignments,...extras},index);

test('all subjects inherit one stage-duration calculation, with shared work counted once', () => {
  for (const id of ids) {
    const subject = models.createSubject({id,chapters:[
      {phase:'一轮',tasks:[{id:'a',estimated_minutes:10},{id:'b',estimated_minutes:90,estimate_group:'b'},{id:'clone',estimated_minutes:90,estimate_group:'b'},{id:'missing',estimated_minutes:null,actual_minutes:999}]},
      {phase:'二轮',tasks:[{id:'next',estimated_minutes:300}]},
    ]});
    const result = subject.stageProgress({phase:'一轮',isCompleted:task=>['a','missing'].includes(task.id)});
    assert.equal(result.totalMinutes,100);
    assert.equal(result.completedMinutes,10);
    assert.equal(result.percent,10);
    assert.equal(result.unknown,1);
    assert.equal(subject.stageProgress({phase:'二轮',isCompleted:()=>true}).percent,100);
    assert.equal(subject.stageProgress({phase:'',isCompleted:()=>false}).totalMinutes,400);
    const completedRound = task => task.id !== 'next';
    assert.equal(subject.stageProgress({selectedIds:['a'],isCompleted:completedRound}).phase,'一轮');
    assert.equal(subject.stageProgress({selectedIds:['a'],isCompleted:completedRound}).percent,100);
  }
});

test('zero or missing stage durations do not fabricate a count-based percentage', () => {
  const subject = models.createSubject({id:'co',chapters:[{phase:'一轮',tasks:[{id:'zero',estimated_minutes:0},{id:'none'},{id:'bad',estimated_minutes:NaN}]}]});
  const result = subject.stageProgress({isCompleted:()=>true});
  assert.equal(result.percent,null);
  assert.equal(result.totalMinutes,0);
  assert.equal(result.unknown,2);
});

test('multi-day check-ins count toward stage progress only after overall finish; reopening reverses it', () => {
  let record = save(store.initialRecord('2026-10-31'),[{task_id:'short',done:true,actual_minutes:0},{task_id:'multi',done:true,actual_minutes:80}],{subject_phases:{ds:'一轮'}});
  assert.equal(store.subjectStageProgress(record,index).ds.percent,5);
  record.library_completed_ids=['multi'];
  assert(Math.abs(store.subjectStageProgress(record,index).ds.percent-55)<1e-10);
  record.library_reopened_ids=['multi'];
  assert.equal(store.subjectStageProgress(record,index).ds.percent,5);
  record.subject_phases.ds='二轮';
  assert.equal(store.subjectStageProgress(record,index).ds.percent,0);
});

test('archived stage progress survives backups and merges and ignores later completion or stage changes', () => {
  const saved = save(store.initialRecord('2026-10-30'),[{task_id:'short',done:true,actual_minutes:6}],{subject_phases:{ds:'一轮'}});
  let advanced = store.archiveRecord(saved,{date:saved.current.date,revision:saved.revision},index);
  const snapshot = advanced.archives[0].subject_stage_progress;
  assert.equal(snapshot.ds.percent,5);
  advanced = save(advanced,[{task_id:'long',done:true,actual_minutes:200}],{subject_phases:{ds:'二轮'}});
  assert.deepEqual(advanced.archives[0].subject_stage_progress,snapshot);
  const restored = store.validateBackup({format:'sjtu-study-checkin-backup',version:1,...advanced},index);
  assert.deepEqual(restored.archives[0].subject_stage_progress,snapshot);
  const existing = {...advanced,archives:advanced.archives.map(({subject_stage_progress,...day})=>day)};
  const merged = store.importRecord(existing,restored,{revision:existing.revision});
  assert.deepEqual(merged.archives[0].subject_stage_progress,snapshot);
  // Older records without a frozen snapshot are reconstructed from dates up to that day only.
  assert.equal(store.subjectStageProgress(advanced,index,advanced.archives[0]).ds.percent,5);
  const corrupt = JSON.parse(JSON.stringify({format:'sjtu-study-checkin-backup',version:1,...advanced}));
  corrupt.archives[0].subject_stage_progress.ds.completedMinutes=-1;
  assert.throws(()=>store.validateBackup(corrupt,index),/阶段进度/);
});

test('daily and exported subject layouts omit the completed frame and hide summaries for empty subjects', () => {
  const source = fs.readFileSync(path.join(__dirname,'../study/app.js'),'utf8');
  const prefix = source.slice(0,source.indexOf("\n  $('daily-tbody').addEventListener"));
  const record = save(store.initialRecord('2026-10-31'),[{task_id:'short',done:true,actual_minutes:7}],{subject_phases:{ds:'一轮'}});
  const context = vm.createContext({raw,view:store.stateOf(record),window:{StudyModels:models,StudyTime:time}});
  vm.runInContext(prefix+`
    library = raw.subjects.map(window.StudyModels.createSubject);
    state = normaliseState(view);
    globalThis.main = subjectGroupsMarkup(state.assignments);
    expandedSubjects.add('ds');
    globalThis.opened = subjectGroupsMarkup(state.assignments);
    globalThis.planOnly = subjectGroupsMarkup([]);
    globalThis.image = subjectGroupsMarkup(state.assignments,{history:true,exporting:true,stageProgress:{ds:{phase:'旧阶段',percent:25,unknown:0,totalMinutes:100,completedMinutes:25}}});
    expandedSubjects.clear();
    globalThis.todayImage = subjectGroupsMarkup(state.assignments,{exporting:true});
  })();`,context);
  assert(!context.main.includes('completed-group'));
  assert(!context.main.includes('group-progress'));
  assert(context.main.match(/id="subject-body-ds"[^>]* hidden/));
  assert(context.main.includes('subject-stage-value">5%</strong>'));
  assert.equal((context.main.match(/class="subject-stage-summary"/g)||[]).length,1);
  assert(context.opened.includes('class="subject-stage-summary" hidden'));
  assert(!context.opened.match(/id="subject-body-ds"[^>]* hidden/));
  assert(context.planOnly.includes('class="daily-phase-panel"'));
  assert(context.planOnly.includes('data-study-phase="二轮"'));
  assert(!context.planOnly.includes('data-card-key'));
  assert(context.image.includes('旧阶段'));
  assert(context.image.includes('subject-stage-value">25%</strong>'));
  assert(!context.image.includes('completed-group'));
  assert(context.image.includes('data-card-key="history:short"'));
  assert(context.todayImage.includes('data-card-key="daily:short"'));
});

test('task picker shows shared stage progress without daily tasks and keeps phase caches separate from search and selection', () => {
  const source = fs.readFileSync(path.join(__dirname,'../study/app.js'),'utf8');
  const prefix = source.slice(0,source.indexOf("\n  $('daily-tbody').addEventListener"));
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id,{id,innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],contains:()=>false});
    return nodes.get(id);
  };
  const context = vm.createContext({raw,document:{getElementById:element,activeElement:null},window:{StudyModels:models,StudyTime:time,clearTimeout(){}}});
  vm.runInContext(prefix+`
    library = raw.subjects.map(window.StudyModels.createSubject);
    state = normaliseState({date:'2026-11-03',assignments:[],completed_ids:['short'],subject_phases:{ds:'一轮'}});
    subjectDraft = {subject:library.find(s=>s.id==='ds'),selected:new Set(),phase:'一轮',chapterId:'ds-a',query:''};
    renderLibrary();
    globalThis.initial = $('library-stage-summary').innerHTML;
    subjectDraft.query='没有匹配结果';
    subjectDraft.selected.add('long');
    renderLibrary();
    globalThis.filtered = $('library-stage-summary').innerHTML;
    subjectDraft.phase='二轮';
    renderLibrary();
    globalThis.next = $('library-stage-summary').innerHTML;
    subjectDraft.phase='';
    renderLibrary();
    globalThis.all = $('library-stage-summary').innerHTML;
    globalThis.main = stageProgressMarkup(subjectDraft.subject,subjectProgress(subjectDraft.subject));
  })();`,context);
  assert(context.initial.includes('role="progressbar"'));
  assert(context.initial.includes('subject-stage-value">5%</strong>'));
  assert.equal(context.initial,context.filtered);
  assert(context.next.includes('subject-stage-value">0%</strong>'));
  assert(context.all.includes('subject-stage-value">2%</strong>'));
  assert.equal(context.main,context.initial);
});
