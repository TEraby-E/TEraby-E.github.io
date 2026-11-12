'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const models = require('../study/learning-model.js');
const time = require('../study/study-time.js');
const store = require('../study/storage.js');
const raw = require('../study/data/library.json');
const app = fs.readFileSync(path.join(__dirname,'../study/app.js'),'utf8');
const prefix = app.slice(0,app.indexOf("\n  $('daily-tbody').addEventListener"));

function motionFixture(reduced=false) {
  const context = vm.createContext({window:{matchMedia:()=>({matches:reduced})}});
  vm.runInContext(prefix+'globalThis.Motion = CardMotion;})();',context);
  const animations=[];
  let visualHeight=null, built=0;
  const attributes = new Set();
  const wrapper={style:{},setAttribute(name){attributes.add(name);},removeAttribute(name){attributes.delete(name);},
    getBoundingClientRect:()=>({height:visualHeight ?? (body.hidden ? 54 : 600)}),
    animate(frames,options){return animate(frames,options,true);}};
  function animate(frames,options,height=false) {
    const animation={frames,options,cancelled:0,cancel(){this.cancelled++;if(height)visualHeight=null;}};
    animations.push(animation);return animation;
  }
  const body={dataset:{loaded:'false'},hidden:true,animate};
  const summary={hidden:false,animate};
  const group={isConnected:true,querySelector(selector){return {'.subject-transition':wrapper,'.subject-body':body,'.subject-stage-summary':summary}[selector];}};
  return {Motion:context.Motion,group,body,summary,wrapper,animations,attributes,build(){built++;},built:()=>built,setVisual:height=>visualHeight=height};
}

test('subject transition reverses from its current height and restores natural layout when finished',()=>{
  const f=motionFixture();
  f.Motion.switchSubject(f.group,true,()=>f.build());
  assert.equal(f.built(),1);
  assert.equal(f.body.hidden,false);
  assert.equal(f.summary.hidden,true);
  assert.equal(f.animations[0].frames[0].height,'54px');
  assert.equal(f.animations[0].frames[1].height,'600px');
  f.setVisual(180);
  f.Motion.switchSubject(f.group,false,()=>f.build());
  assert.equal(f.animations[0].cancelled,1);
  assert.equal(f.animations[2].frames[0].height,'180px');
  assert.equal(f.animations[2].frames[1].height,'54px');
  f.animations[2].onfinish();
  assert.equal(f.wrapper.style.overflow,'');
  assert.equal(f.attributes.size,0);
  assert.equal(f.Motion.activeSubjects.size,0);
  f.Motion.switchSubject(f.group,true,()=>f.build());
  assert.equal(f.built(),1,'a repeated expansion reuses existing cards');
  f.Motion.finishSubjects();
  assert.equal(f.Motion.activeSubjects.size,0,'render/export settles active animations');
  assert.equal(f.body.hidden,false);
});

test('reduced motion switches subject content immediately without creating animation layers',()=>{
  const f=motionFixture(true);
  f.Motion.switchSubject(f.group,true,()=>f.build());
  assert.equal(f.animations.length,0);
  assert.equal(f.body.hidden,false);
  assert.equal(f.summary.hidden,true);
  assert.equal(f.built(),1);
});

test('collapsed subjects and phases create no detail cards; opening a phase renders only its tasks',()=>{
  const tasks=raw.subjects.flatMap(s=>s.chapters.flatMap(c=>c.tasks.map(t=>({...t,task_id:t.id,subject_id:s.id,done:false}))).slice(0,13)).slice(0,100);
  const context=vm.createContext({raw,tasks,window:{StudyModels:models,StudyTime:time}});
  vm.runInContext(prefix+`
    library=raw.subjects.map(window.StudyModels.createSubject);
    state=normaliseState({date:'2026-10-31',assignments:tasks});
    globalThis.closed=subjectGroupsMarkup(state.assignments);
    const first=library[0];
    globalThis.progressA=subjectProgress(first);
    globalThis.progressB=subjectProgress(first);
    expandedSubjects.add(first.id);
    globalThis.phaseClosed=subjectGroupsMarkup(state.assignments);
    expandedDailyPhases.add(studyPhaseKey(first.id, first.chapters[0].phase));
    globalThis.opened=subjectGroupsMarkup(state.assignments);
    state.assignments[0].done=true;
    changeVersion++;
    globalThis.progressC=subjectProgress(first);
  })();`,context);
  assert(!context.closed.includes('data-card-key'));
  assert(Buffer.byteLength(context.closed)<20000);
  assert(context.phaseClosed.includes('class="daily-phase-panel"'));
  assert(!context.phaseClosed.includes('data-card-key'));
  assert.equal((context.opened.match(/data-card-key/g)||[]).length,13);
  assert.equal(context.progressA,context.progressB);
  assert.notEqual(context.progressA,context.progressC);
  assert(context.progressC.completedMinutes>context.progressA.completedMinutes);
});

test('history and backup use readonly transactions, leaving editing transactions available',async()=>{
  const modes=[],puts=[];
  const record=store.helpers.initialRecord('2026-10-31');
  const index=store.helpers.libraryIndex(raw);
  const assignments=store.helpers.normaliseAssignments([{task_id:index.keys().next().value,done:true}],index);
  record.plan_library=raw;
  record.archives=[{date:'2026-10-30',assignments,subject_stage_progress:{}}];
  const db={close(){},transaction(name,mode){
    modes.push(mode);
    const tx={objectStore(){return {get(){const req={result:structuredClone(record)};queueMicrotask(()=>{req.onsuccess();queueMicrotask(()=>tx.oncomplete());});return req;},put(value){puts.push(value);}};}};
    return tx;
  }};
  const env={location:{href:'https://example.test/study/'},document:{currentScript:{src:'https://example.test/study/storage.js?v=release'}},
    indexedDB:{open(){const req={result:db};queueMicrotask(()=>req.onsuccess());return req;}},
    async fetch(url,options){assert(url.includes('v=release'));assert.equal(options.cache,'force-cache');return {ok:true,json:async()=>raw};}};
  const api=store.createStore(env);
  await api.request('/api/history/2026-10-30');
  await api.exportBackup();
  assert.deepEqual(modes,['readonly','readonly']);
  assert.equal(puts.length,0);
  await api.request('/api/state');
  assert.equal(modes[2],'readwrite');
  await api.close();
});

test('a worker bypasses its own cache for a request from another release',async()=>{
  const handlers={};let opened=0,fetched=0;
  const context=vm.createContext({URL,Request,self:{registration:{scope:'https://example.test/study/'},location:{origin:'https://example.test'},addEventListener(name,fn){handlers[name]=fn;}},
    caches:{async open(){opened++;throw new Error('wrong-release cache access');}},async fetch(){fetched++;return 'fresh';}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../study/sw.js'),'utf8'),context);
  let response;
  handlers.fetch({request:new Request('https://example.test/study/app.js?v=future'),respondWith(value){response=value;}});
  assert.equal(await response,'fresh');
  assert.equal(fetched,1);
  assert.equal(opened,0);
});

test('the worker builds an offline default-plan download from the cached catalogue', async () => {
  const handlers = {};
  const scope = 'https://example.test/project/study/';
  const context = vm.createContext({
    URL, Request, Response,
    self: { registration: { scope }, location: { origin: new URL(scope).origin }, addEventListener(name, fn) { handlers[name] = fn; } },
    caches: { async open() {
      return { async match(key) {
        assert.equal(key, new URL('data/library.json', scope).href);
        return new Response(JSON.stringify(raw));
      } };
    } },
    async fetch() { throw new Error('offline'); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../study/sw.js'), 'utf8'), context);
  let response;
  handlers.fetch({ request: new Request(new URL('plans/default-plan.json', scope)), respondWith(value) { response = value; } });
  assert.deepEqual(await (await response).json(), store.plan.pack(raw));
});
