// Self-contained for the isolated snapshot renderer. Read attributes, never run handlers.
export function collectPRDEvidence(doc,root){
 if(!root)return [];
 const clean=el=>{const copy=el.cloneNode(true);copy.querySelectorAll('[aria-hidden="true"],svg,i').forEach(n=>n.remove());return (el.getAttribute('aria-label')||copy.textContent||el.getAttribute('placeholder')||'').replace(/\s+/g,' ').trim();};
 const controls=[...(root.matches('a,button,input,select,textarea,[role="tab"]')?[root]:[]),...root.querySelectorAll('a,button,input,select,textarea,[role="tab"]')];
 return controls.slice(0,40).map(el=>{
  const handler=el.getAttribute('onclick')||'',jump=/^(?:\s*(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]\s*;?\s*)$/.exec(handler);
  const href=el.getAttribute('href')||jump?.[1]||null,navigation=!!el.closest('header,nav,[role="navigation"]');
  let samePage=false;try{const url=new URL(href,doc.location.href);samePage=href!==null&&doc.location.protocol!=='about:'&&url.origin===doc.location.origin&&url.pathname===doc.location.pathname&&url.search===doc.location.search;}catch{}
  const destination=href?[...doc.querySelectorAll('nav a[href],[role="navigation"] a[href]')].find(a=>{try{return new URL(a.getAttribute('href'),doc.location.href).href===new URL(href,doc.location.href).href;}catch{return a.getAttribute('href')===href;}}):null;
  return {destinationTitle:destination?clean(destination).slice(0,120):'',tag:el.localName,text:clean(el).slice(0,120),href:href?.slice(0,1000)??null,navigation,current:el.getAttribute('aria-current')==='page'||el.getAttribute('aria-selected')==='true'||navigation&&/(?:^|\s)(?:active|selected|current|is-active|is-selected)(?:\s|$)/.test(el.className||''),samePage,target:el.getAttribute('target')||'',inputType:el.getAttribute('type')||'',required:!!el.required,disabled:!!el.disabled};
 });
}
export function validatePRDEvidence(value){
 if(!Array.isArray(value))return [];
 return value.slice(0,40).map(item=>({destinationTitle:String(item?.destinationTitle||'').slice(0,120),tag:String(item?.tag||'').slice(0,20),text:String(item?.text||'').slice(0,120),href:typeof item?.href==='string'?item.href.slice(0,1000):null,navigation:item?.navigation===true,current:item?.current===true,samePage:item?.samePage===true,target:String(item?.target||'').slice(0,30),inputType:String(item?.inputType||'').slice(0,30),required:item?.required===true,disabled:item?.disabled===true}));
}

// Pure navigation needs one sentence per action; decorative content is not a rule.
export function summarizeKnownNavigation(evidence){
 if(!evidence?.length||evidence.some(e=>!['a','button'].includes(e.tag)||!e.href||!e.destinationTitle||e.disabled))return '';
 const actions=evidence.filter(e=>!e.current);
 return [...new Set(actions.map(e=>`点击“${e.text}”，${e.target==='_blank'?'在新窗口打开':'跳转到'}“${e.destinationTitle}”。`))].join('');
}
