const test = require('node:test');
const assert = require('node:assert/strict');
const { splitText, bytes, addTask, processTask, INPUT_TOKENS, upgradePlan, OUTPUT, CONTEXT } = require('../server/book/engine');
function setup(source) {
  const job = { focus:'Summarize the book.', tasks:[], events:[] };
  const task = addTask(job, { kind:'chapter', title:'Chapter one', source });
  const calls = [];
  const io = { gate:async()=>{}, save:async()=>{}, measure:async(prompt)=>Math.ceil(bytes(prompt)/3), generate:async(prompt) => { calls.push(prompt); assert.ok(Math.ceil(bytes(prompt)/3) <= INPUT_TOKENS); return { response:'A concise summary of the supplied material.', prompt_eval_count: Math.ceil(bytes(prompt)/3), eval_count:12, done_reason:'stop' }; } };
  return { job, task, calls, io };
}
test('UTF-8 splitting preserves all text, including giant paragraphs and Unicode', () => {
  const source = 'Hello 👋 世界\n'.repeat(6000);
  const chunks = splitText(source, 1300);
  assert.equal(chunks.join(''),source); assert.ok(chunks.every(c => bytes(c) <= 1300));
});
test('long chapters split dynamically and only bounded prompts reach inference', async () => {
  const {job,task,calls,io} = setup('This is an extended chapter.\n'.repeat(2000));
  assert.equal(job.tasks.length,1);
  await processTask(job,task,io);
  assert.ok(task.children.length > 1); assert.ok(task.reducer); assert.equal(task.status,'done');
  assert.equal(calls.length,job.tasks.filter(t => t.outputTokens).length);
  const before = calls.length; await processTask(job,task,io); assert.equal(calls.length,before);
});
test('book synthesis recursively reduces a large collection of chapter summaries', async () => {
  const { job, io, calls } = setup(''); job.tasks = [];
  const ids = Array.from({length:60},(_,i) => addTask(job,{kind:'chapter', title:`Chapter ${i}`, status:'done', result:'Important evidence and conclusions. '.repeat(20)}).id);
  const book = addTask(job,{kind:'book', title:'Full book summary', dependencies:ids});
  await processTask(job,book,io); assert.equal(book.status,'done'); assert.ok(book.children.length > 1); assert.ok(calls.length > 3);
});
test('unsafe, missing, empty, and truncated model responses are rejected', async () => {
  for (const result of [{response:'x',prompt_eval_count:CONTEXT-OUTPUT+1},{response:'x'},{response:'',prompt_eval_count:5},{response:'x',prompt_eval_count:5,done_reason:'length'}]) {
    const {job,task,io}=setup('Short text'); io.generate=async()=>result;
    await assert.rejects(processTask(job,task,io)); assert.notEqual(task.status,'done');
  }
});
test('pause stops processing before the next model request and resume reuses completed children', async () => {
  const {job,task,io,calls}=setup('Evidence and narrative.\n'.repeat(4000));
  io.gate=async()=> { if(calls.length >= 2) throw new Error('paused'); };
  await assert.rejects(processTask(job,task,io),/paused/);
  const completed=job.tasks.filter(t=>t.status==='done').map(t=>t.id);
  assert.equal(completed.length,2);
  io.gate=async()=>{}; await processTask(job,task,io);
  assert.ok(completed.every(id=>job.tasks.find(t=>t.id===id).status==='done'));
  assert.equal(calls.length,job.tasks.filter(t=>t.outputTokens).length);
});

test('over-budget measured candidates subdivide; estimates never authorize generation', async () => {
  const {job,task,io,calls}=setup('A sentence with supporting evidence. '.repeat(400));
  io.measure=async(prompt)=>bytes(prompt)>11000 ? Infinity : Math.ceil(bytes(prompt)/2);
  io.generate=async(prompt)=>{calls.push(prompt);assert.ok(bytes(prompt)<=11000);return {response:'A concise summary.',prompt_eval_count:Math.ceil(bytes(prompt)/2),eval_count:10};};
  await processTask(job,task,io);assert.equal(task.status,'done');assert.ok(task.children.length>1);
});
test('legacy upgrade preserves completed work and consolidates only unfinished leaves', () => {
  const {job,task}=setup('Full source');
  const done=addTask(job,{parentId:task.id,source:'done',status:'done',result:'Kept'});
  const a=addTask(job,{parentId:task.id,source:'First '});const b=addTask(job,{parentId:task.id,source:'second.'});
  task.children=[done.id,a.id,b.id];upgradePlan(job);
  assert.equal(task.children.length,2);assert.equal(job.tasks.find(t=>t.id===done.id).result,'Kept');
  assert.equal(job.tasks.find(t=>t.id===task.children[1]).source,'First second.');
  const ids=job.tasks.map(t=>t.id);upgradePlan(job);assert.deepEqual(job.tasks.map(t=>t.id),ids);
});
test('measured reading passages can use over 4K input tokens', async () => {
  const {job,task,io}=setup('Evidence leads to a careful conclusion. '.repeat(350));
  await processTask(job,task,io);assert.equal(task.children.length,0);assert.ok(task.measuredTokens>4000);assert.ok(task.measuredTokens<=INPUT_TOKENS);
});
test('output truncation continues the saved draft without imposing a word limit', async()=>{
 const {job,task,io}=setup('A short source passage.');let requests=0;
 io.generate=async(prompt,t)=>({response:++requests===1 ? 'First perform the setup. Then ' : 'check the result and handle exceptions.',prompt_eval_count:Math.ceil(bytes(prompt)/3),eval_count:requests===1?t.outputReserve:10,done_reason:requests===1?'length':'stop'});
 await processTask(job,task,io);assert.equal(requests,2);assert.equal(task.status,'done');assert.equal(task.result,'First perform the setup. Then check the result and handle exceptions.');assert.equal(task.generationAttempts[0].reason,'length');assert.ok(task.generationAttempts[1].continuation);assert.ok(!/at most \d+ words/.test(task.prompt));assert.ok(task.outputTokens>OUTPUT);
});
test('pause after an output limit saves the draft and resume continues it',async()=>{
 const {job,task,io}=setup('A procedure with important exceptions.');let requests=0;
 io.generate=async(p,t)=>({response:++requests===1?'Step one. ':'Step two.',prompt_eval_count:Math.ceil(bytes(p)/3),eval_count:10,done_reason:requests===1?'length':'stop'});
 io.gate=async()=>{if(requests===1)throw Error('paused');};
 await assert.rejects(processTask(job,task,io),/paused/);assert.equal(task.summarySegments[0].text,'Step one. ');assert.equal(task.result,undefined);
 io.gate=async()=>{};await processTask(job,task,io);assert.equal(task.result,'Step one. Step two.');assert.equal(requests,2);
});
test('continued output is measured and respects context even when the initial input nearly fills its allowance',async()=>{
 const {job,task,io}=setup('Source material');let calls=0;
 io.measure=async p=>p.includes('PREVIOUS SUMMARY ENDING')?7100:6656;
 io.generate=async(p,t)=>{assert.ok(t.measuredTokens+t.outputReserve+512<=CONTEXT);return {response:++calls===1?'First part. ':'Last part.',prompt_eval_count:t.measuredTokens,eval_count:10,done_reason:calls===1?'length':'stop'};};
 await processTask(job,task,io);assert.equal(task.result,'First part. Last part.');assert.equal(calls,2);
});
