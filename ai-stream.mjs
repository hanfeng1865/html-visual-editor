// Decode SSE frames across arbitrary network and UTF-8 chunk boundaries.
export async function readAIEvents(response,onEvent) {
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0;
  function frame(value) {
    const data=value.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data || data==='[DONE]')return;
    let event;try{event=JSON.parse(data);}catch{throw new Error('流式响应格式无效，请重试');}
    onEvent(event);
  }
  try {
    while(true){
      const {value,done}=await reader.read();
      if(done){buffer+=decoder.decode();if(buffer.trim())frame(buffer);break;}
      bytes+=value.byteLength;if(bytes>12*1024*1024)throw new Error('模型响应超过 12MB 限制');
      buffer+=decoder.decode(value,{stream:true});
      let boundary;while((boundary=/\r?\n\r?\n/.exec(buffer))){frame(buffer.slice(0,boundary.index));buffer=buffer.slice(boundary.index+boundary[0].length);}
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function partialSummary(content) {
  const match=/^\s*(?:```(?:json)?\s*)?\{\s*"summary"\s*:\s*"((?:\\.|[^"\\])*)/.exec(content);
  if(!match)return '';
  try{return JSON.parse('"'+match[1]+'"').slice(0,2000);}catch{return '';}
}
export async function readAIModelResponse(response,onProgress) {
  if(!response.headers.get('content-type')?.includes('text/event-stream')) {
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>12*1024*1024)throw new Error('模型响应超过 12MB 限制');chunks.push(chunk);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let result;try{result=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('模型接口未返回有效 JSON');}
    const summary=partialSummary(result.choices?.[0]?.message?.content||'');if(summary)onProgress?.({type:'summary',text:summary});
    return result;
  }
  let content='',finishReason=null,lastSummary='',lastUpdate=0;
  await readAIEvents(response,event=>{
    if(event.error)throw new Error('模型流式响应失败：'+(event.error.message||'接口错误'));
    const choice=event.choices?.[0];if(!choice)return;
    if(choice.finish_reason)finishReason=choice.finish_reason;
    if(typeof choice.delta?.content==='string')content+=choice.delta.content;
    // Only display the requested short plan; raw code and private reasoning fields
    // stay out of the process UI.
    const summary=partialSummary(content);
    if(summary && summary!==lastSummary){lastSummary=summary;onProgress?.({type:'summary',text:summary});}
    if(Date.now()-lastUpdate>=150){lastUpdate=Date.now();onProgress?.({type:'output',characters:content.length});}
  });
  if(!finishReason)throw new Error('模型流式响应中断，未收到完整结果，请重试');
  return {choices:[{finish_reason:finishReason,message:{content}}]};
}
