// Conversation storage is scoped to the currently opened project and page.
export function createAIChat({input,log,storageKey}) {
  const historyPanel=log.closest('#ai-chat-history');
  let messages=[];
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');
    messages=(Array.isArray(saved.messages)?saved.messages:[]).filter(item=>item && ['user','assistant'].includes(item.role) && typeof item.content==='string').slice(-40);
    input.value=typeof saved.input==='string'?saved.input.slice(0,12000):'';
  }catch{}
  function save(){try{localStorage.setItem(storageKey,JSON.stringify({messages,input:input.value}));}catch{}}
  function render(){
    log.replaceChildren();log.hidden=!messages.length;
    if(historyPanel)historyPanel.hidden=!messages.length;
    for(const item of messages){const row=document.createElement('p'),name=document.createElement('b'),text=document.createElement('span');row.className=`ai-chat-message ${item.role}`;name.textContent=item.role==='user'?'你':'AI';text.textContent=item.content;row.append(name,text);log.append(row);}
    log.scrollTop=log.scrollHeight;
  }
  input.addEventListener('input',save);render();
  return {
    value:()=>input.value.trim(),
    history:()=>messages.slice(-12).map(({role,content})=>({role,content})),
    add(role,content){messages.push({role,content:content.slice(0,12000)});messages=messages.slice(-40);save();render();},
    clearInput(){input.value='';if(historyPanel)historyPanel.open=false;save();},
  };
}
