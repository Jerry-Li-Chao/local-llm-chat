const test = require('node:test');
const assert = require('node:assert/strict');
const { budgetFor } = require('../server/book/budget');
const { addTask, processTask, bytes } = require('../server/book/engine');
test('reading target reserves output and safety margin, preserving the 8K default', () => {
 assert.deepEqual(budgetFor(), {target:6000,context:8192,input:6656,output:1024});
 for(let target=2000;target<=64000;target+=1000){const b=budgetFor({chunkTarget:target});assert.ok(b.input>=target);assert.ok(b.input+b.output+512<=b.context);assert.ok(b.context<=65536);}
 for(const target of [0,1999,64001,65000,6000.5,'6000',NaN])assert.throws(()=>budgetFor({chunkTarget:target}));
});
test('larger target admits a measured passage above 8K and records its actual context', async () => {
 const job={chunkTarget:16000,focus:'Summarize',tasks:[],events:[]};
 const task=addTask(job,{kind:'chapter',title:'Chapter',source:'A paragraph about the evidence. '.repeat(1100)});
 let calls=0;
 await processTask(job,task,{gate:async()=>{},save:async()=>{},measure:async p=>Math.ceil(bytes(p)/3),generate:async p=>{calls++;return {response:'The evidence supports the main argument.',prompt_eval_count:Math.ceil(bytes(p)/3),eval_count:10,done_reason:'stop'};}});
 assert.equal(calls,1);assert.ok(task.measuredTokens>8192);assert.equal(task.contextLimit,18432);assert.equal(task.children.length,0);
});
