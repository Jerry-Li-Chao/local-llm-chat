const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createBookService } = require('../server/book/service');
async function fixture(t) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'book-clear-'));await fs.mkdir(path.join(dir,'books'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const id=randomUUID(), other=randomUUID();
 const job={id,status:'paused',model:'test',focus:'Summarize',tasks:[{id:'task',kind:'chapter',title:'Test',source:'Text to summarize.',status:'queued',children:[]}],events:[],pages:['Text'],chapters:[]};
 for(const suffix of ['.json','.json.before-chunking-v2'])await fs.writeFile(path.join(dir,'books',id+suffix),JSON.stringify(job));
 await fs.writeFile(path.join(dir,'books',other+'.json'),'{}');
 const route=createBookService({dataDir:dir,baseUrl:'http://test',readJsonBody:async()=>({}),writeJson:(res,status,body)=>Object.assign(res,{status,body})});
 const call=async(method,url)=>{const res={};await route({method},res,new URL('http://test/api/books/'+id+url));return res;};
 return {dir,id,other,call};
}
test('clear removes only the selected book and its backup, and is idempotent',async t=>{
 const {dir,other,call}=await fixture(t);
 assert.equal((await call('DELETE','')).status,200);
 assert.deepEqual(await fs.readdir(path.join(dir,'books')),[other+'.json']);
 assert.equal((await call('DELETE','')).status,200);
 assert.equal((await call('GET','')).status,400);
});
test('clear aborts active inference and waits for final save before deleting',async t=>{
 const {dir,other,call}=await fixture(t);
 let entered;const started=new Promise(r=>entered=r);let aborted=false;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url.endsWith('/api/ps'))return {ok:true,json:async()=>({models:[]})};
  if(url.endsWith('/api/show'))return {ok:true,json:async()=>({model_info:{'test.context_length':8192}})};
  if(url.endsWith('/api/version'))return {json:async()=>({version:'0.34.0'})};
  entered();return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true});});
 });
 assert.equal((await call('POST','/start')).status,202);await started;
 assert.equal((await call('DELETE','')).status,200);assert.equal(aborted,true);
 assert.deepEqual(await fs.readdir(path.join(dir,'books')),[other+'.json']);
 assert.equal((await call('POST','/start')).status,400);
});
