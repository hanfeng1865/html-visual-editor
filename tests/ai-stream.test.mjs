import test from 'node:test';
import assert from 'node:assert/strict';
import {readAIEvents,readAIModelResponse} from '../ai-stream.mjs';
function streamResponse(text,step=7){
 const bytes=new TextEncoder().encode(text);
 return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=step)controller.enqueue(bytes.slice(i,i+step));controller.close();}}),{headers:{'content-type':'text/event-stream'}});
}
const frame=value=>'data: '+JSON.stringify(value)+'\r\n\r\n';
test('SSE preserves Chinese text across byte boundaries and ignores heartbeat frames',async()=>{
 const events=[];
 await readAIEvents(streamResponse(': keepalive\r\n\r\n'+frame({text:'修改标题'})+'data: [DONE]\r\n\r\n',1),event=>events.push(event));
 assert.deepEqual(events,[{text:'修改标题'}]);
});
test('model summaries arrive incrementally while code and reasoning fields stay out of progress',async()=>{
 const content=JSON.stringify({summary:'修改标题，\n保留交互。',edits:[{after:'<h1>新标题</h1>'}],explanation:'已修改'}),events=[];
 const messages=[];
 for(let i=0;i<content.length;i+=6)messages.push(frame({choices:[{delta:{content:content.slice(i,i+6),reasoning_content:'private draft'}}]}));
 messages.push(frame({choices:[{delta:{},finish_reason:'stop'}]}),'data: [DONE]\n\n');
 const result=await readAIModelResponse(streamResponse(messages.join('')),event=>events.push(event));
 assert.equal(result.choices[0].message.content,content);
 const summaries=events.filter(event=>event.type==='summary');
 assert.ok(summaries.length>1);assert.equal(summaries.at(-1).text,'修改标题，\n保留交互。');
 assert.ok(!JSON.stringify(events).includes('private draft'));assert.ok(!JSON.stringify(events).includes('<h1>'));
});
test('interrupted or malformed streams do not produce an applicable result',async()=>{
 await assert.rejects(readAIModelResponse(streamResponse(frame({choices:[{delta:{content:'{"summary":"未完成'}}]}))),/中断/);
 await assert.rejects(readAIModelResponse(streamResponse('data: {invalid}\n\n')),/格式无效/);
});
test('non-streaming model responses remain supported',async()=>{
 const content=JSON.stringify({summary:'更新标题',edits:[],explanation:'修改说明'}),progress=[];
 const response=new Response(JSON.stringify({choices:[{message:{content}}]}),{headers:{'content-type':'application/json'}});
 const result=await readAIModelResponse(response,event=>progress.push(event));
 assert.equal(result.choices[0].message.content,content);assert.deepEqual(progress,[{type:'summary',text:'更新标题'}]);
});
