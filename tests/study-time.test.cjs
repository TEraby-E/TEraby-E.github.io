 'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const time = require('../study/study-time.js');

test('actual totals ignore legacy planned fields and uncompleted work', () => {
  const summary = time.summarizeActual([
    {task_id:'a',done:true,actual_minutes:42,estimated_minutes:600},
    {task_id:'b',done:true,actual_minutes:null,estimated_minutes:20},
    {task_id:'c',done:false,actual_minutes:99,estimated_minutes:30},
    {task_id:'d',done:true,actual_minutes:0,estimated_minutes:5},
  ]);
  assert.deepEqual(summary,{actualMinutes:42,actualUnknown:1,actualKnown:2,actualGroups:2});
  assert.equal(time.getEstimate,undefined);
  assert.equal(time.comparisonLabel,undefined);
});

test('shared source tasks count actual time once', () => {
  const tasks=['calculus','linear','probability'].map(subject_id => ({subject_id,task_id:subject_id,estimate_group:'shared-paper',done:true,actual_minutes:135}));
  assert.equal(time.summarizeActual(tasks).actualMinutes,135);
  assert.equal(time.summarizeActual(tasks).actualGroups,1);
});

test('zero and missing actual time remain distinct', () => {
  assert.equal(time.getActual({done:true,actual_minutes:0}).label,'实际0分钟');
  assert.equal(time.getActual({done:true}).label,'实际未记录');
  assert.equal(time.getActual({done:false,actual_minutes:20}).label,'实际待完成');
});

test('formatting handles decimal minutes and hour boundaries', () => {
  assert.equal(time.formatMinutes(60),'1小时');
  assert.equal(time.formatMinutes(62.5),'1小时2.5分钟');
  assert.equal(time.formatMinutes(0),'0分钟');
  assert.equal(time.summarizeActual([{done:true,actual_minutes:0.1},{done:true,actual_minutes:0.2}]).actualMinutes,0.3);
});

test('invalid actual values are never included in totals', () => {
  for(const value of [-1,Infinity,NaN,'20']) assert.equal(time.getActual({done:true,actual_minutes:value}).recorded,false);
  assert.equal(time.summarizeActual([]).actualMinutes,0);
});
