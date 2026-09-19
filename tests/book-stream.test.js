const test=require('node:test');const assert=require('node:assert/strict');
const {readGeneration}=require('../server/book/stream');
const response=chunks=>({ok:true,body:(async function*(){for(const chunk of chunks)yield chunk;})()});
test('streaming keeps Unicode and final token metrics across arbitrary network boundaries',async()=>{
 const data=Buffer.from(JSON.stringify({response:'Ideas 世界',done:false})+'\n'+JSON.stringify({response:'.',done:true,prompt_eval_count:15000,eval_count:2500})+'\n');
 const chunks=Array.from(data,b=>Buffer.from([b]));
 const result=await readGeneration(response(chunks));assert.equal(result.response,'Ideas 世界.');assert.equal(result.prompt_eval_count,15000);assert.equal(result.eval_count,2500);
});
test('incomplete streams and model errors cannot become finished summaries',async()=>{
 await assert.rejects(readGeneration(response([Buffer.from('{"response":"Partial"}\n')])),/disconnected/);
 await assert.rejects(readGeneration(response([Buffer.from('{"error":"model stopped"}\n')])),/model stopped/);
 await assert.rejects(readGeneration({ok:false,status:500,text:async()=>'{"error":"server failed"}'}),/server failed/);
});
