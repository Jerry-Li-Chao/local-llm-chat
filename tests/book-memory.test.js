const test = require('node:test');
const assert = require('node:assert/strict');
const { ollamaRss, recordSample, monitorMemory, createSampler } = require('../server/book/memory');
test('RSS includes Ollama and descendants, excluding unrelated servers',()=>{
 const result=ollamaRss('1 0 10 /Applications/Ollama.app/Contents/MacOS/Ollama\n2 1 20 /resources/ollama\n3 2 300 /resources/llama-server\n4 0 9000 /other/llama-server');
 assert.equal(result.ollamaRssBytes,330*1024);assert.equal(result.processCount,3);
 assert.deepEqual(ollamaRss('1 0 100 /usr/bin/node'),{});
});
test('peaks are maxima, minima track free memory, missing values remain unavailable',()=>{
 const m={samples:0,readErrors:0};recordSample(m,{modelBytes:100,hostFreeBytes:300});recordSample(m,{modelBytes:90,hostFreeBytes:200});recordSample(m,{});
 assert.equal(m.peakModelBytes,100);assert.equal(m.minHostFreeBytes,200);assert.equal(m.peakGpuBytes,undefined);assert.equal(m.samples,3);
});
test('captures initial and final samples; preserves previous peaks across phases and retries',async()=>{
 const task={};let n=0;const sample=async()=>({modelBytes:++n*100});
 await monitorMemory(task,'context check',sample,async()=>({prompt_eval_count:40}),{intervalMs:10000});
 await monitorMemory(task,'summary generation',sample,async()=>({eval_count:20}),{intervalMs:10000});
 assert.equal(task.memory.peakModelBytes,400);assert.equal(task.memory.phases.length,2);assert.equal(task.memory.phases[0].inputTokens,40);assert.equal(task.memory.phases[1].outputTokens,20);
});
test('aborted generation retains samples and sampler failures never fail inference',async()=>{
 const task={};await assert.rejects(monitorMemory(task,'summary generation',async()=>({modelBytes:10}),async()=>{throw Error('aborted');}),/aborted/);
 assert.equal(task.memory.peakModelBytes,10);assert.equal(task.memory.phases[0].status,'interrupted');
 assert.equal(await monitorMemory(task,'retry',async()=>{throw Error('no metrics');},async()=>42),42);
 assert.equal(task.memory.peakModelBytes,10);assert.ok(task.memory.readErrors>0);
});
test('remote Ollama samples the selected model only, never local process RAM',async()=>{
 const sample=createSampler({baseUrl:'http://remote-server:11434',model:'gemma:test',fetchImpl:async()=>({ok:true,json:async()=>({models:[{name:'other',size:900},{name:'gemma:test',size:200,size_vram:100,context_length:8192}]})}),executeImpl:async()=>{throw Error('Must not sample this computer');}});
 const value=await sample();assert.equal(value.modelBytes,200);assert.equal(value.gpuBytes,100);assert.equal(value.hostFreeBytes,undefined);assert.equal(value.ollamaRssBytes,undefined);
});
test('chapter memory rollups take maxima, exports retain raw phase records',async()=>{
 const {memoryFor,memoryExport}=await import('../public/book-memory.js');
 const root={id:'a',title:'Chapter',children:['b','c']};const tasks=[root,{id:'b',parentId:'a',memory:{samples:3,peakModelBytes:100,phases:[]}},{id:'c',parentId:'a',memory:{samples:2,peakModelBytes:120,phases:[]}}];
 assert.equal(memoryFor(root,tasks).peakModelBytes,120);assert.equal(memoryFor(root,tasks).samples,5);
 const data=memoryExport({name:'test.pdf',tasks});assert.equal(data.tasks[0].memory,null);assert.equal(data.tasks[1].memory.peakModelBytes,100);
});
test('memory table labels resident RAM and adds the lowest sampled free memory',async()=>{
 const {memoryTable}=await import('../public/book-memory.js');
 const html=memoryTable({tasks:[{id:'a',title:'Chapter',children:[],memory:{samples:2,minHostFreeBytes:2*1024**3}}]});
 assert.ok(html.includes('Ollama RAM (RSS)'));assert.ok(html.includes('Lowest free memory'));assert.ok(html.includes('2.00 GiB'));assert.ok(html.includes('not its current value'));
});
