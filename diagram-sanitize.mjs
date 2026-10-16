import {randomUUID} from 'node:crypto';
import {normalizeDiagramDocument} from './diagram-presentation.mjs';
import {inspectDiagramLayout} from './diagram-layout.mjs';
const fail=message=>Object.assign(new Error(message),{statusCode:502});
export async function sanitizeDiagram(html,title){
 if(typeof html!=='string'||Buffer.byteLength(html)>350000||!html.trim())throw fail('AI 图解内容为空或过大');
 const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage({javaScriptEnabled:false,viewport:{width:1200,height:900}});await page.route('**/*',route=>route.abort());
 await page.setContent(html,{waitUntil:'domcontentloaded',timeout:10000});
 const result=await page.evaluate(({title,prefix})=>{
  const bad=message=>{throw new Error(message);};
  const allowed=new Set('html head body title meta style div section article header footer main aside h1 h2 h3 h4 h5 h6 p span strong em b i small br hr ul ol li dl dt dd table thead tbody tfoot tr th td caption figure figcaption svg g path rect circle ellipse line polyline polygon text tspan defs marker clippath lineargradient radialgradient stop desc'.split(' '));
  const safeProperties=new Set('display position top right bottom left inset z-index box-sizing width height min-width max-width min-height max-height aspect-ratio margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-top border-right border-bottom border-left border-width border-style border-color border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style border-top-color border-right-color border-bottom-color border-left-color border-radius border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius background-color color font font-family font-size font-weight font-style font-variant line-height letter-spacing word-spacing text-align text-decoration text-transform text-indent white-space overflow overflow-x overflow-y overflow-wrap word-break text-overflow gap row-gap column-gap flex flex-grow flex-shrink flex-basis flex-direction flex-wrap align-items align-content align-self justify-content justify-items justify-self order grid-template-columns grid-template-rows grid-column grid-row grid-auto-flow vertical-align border-collapse border-spacing table-layout list-style-type opacity visibility fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit text-anchor dominant-baseline paint-order vector-effect transform transform-origin transform-box marker-start marker-mid marker-end clip-path stop-color stop-opacity x y cx cy r rx ry'.split(' '));
  const urlPattern=/url\(\s*(["']?)(#[\w.-]+)\1\s*\)/gi;
  function validateCSS(value){
   const stripped=value.replace(urlPattern,'');
   if(/var\s*\(|--[\w-]+\s*:|url\s*\(|@|expression\s*\(|(?:javascript|vbscript|data|https?):|\\|\/\*/i.test(stripped))bad('图解包含非本地或不支持的 CSS 资源');
  }
  for(const node of document.querySelectorAll('*')){
   const tag=node.localName.toLowerCase();if(!allowed.has(tag))bad('图解包含不支持或危险标签：'+tag);
   if(tag==='meta'&&node.hasAttribute('http-equiv'))bad('图解禁止 HTTP 元数据或重定向');
   if(tag==='meta'&&node.parentElement!==document.head)bad('图解元数据只能放在 head 中');
   if(tag==='meta'&&!node.hasAttribute('charset')&&!(node.getAttribute('name')?.toLowerCase()==='viewport'&&!node.hasAttribute('http-equiv')))bad('图解禁止重定向或外部元数据');
   for(const a of node.attributes){
    if(/^on/i.test(a.name)||['src','srcset','href','xlink:href','action','formaction','background'].includes(a.name.toLowerCase()))bad('图解禁止事件或资源引用');
    if(/(?:javascript|vbscript|data|https?):\s*|\/\//i.test(a.value)&&a.name!=='xmlns')bad('图解包含外部资源');
    if(a.name==='style'||safeProperties.has(a.name.toLowerCase())||['filter','mask','cursor'].includes(a.name.toLowerCase())||/url\s*\(/i.test(a.value))validateCSS(a.value);
   }
  }
  for(const style of document.querySelectorAll('style')){validateCSS(style.textContent);if(/::|:(?:before|after|hover|active|focus|visited)/i.test(style.textContent))bad('图解不支持动态或伪元素样式');}
  let root=document.querySelector('[data-editor-component="diagram"]');
  if(!root){root=document.createElement('div');while(document.body.firstChild)root.append(document.body.firstChild);document.body.append(root);}
  if(root.localName!=='div'||document.querySelectorAll('[data-editor-component="diagram"]').length>1)bad('图解必须是单个 div 组件');
  if([...document.body.children].some(n=>n!==root&&n.tagName!=='STYLE'))bad('图解内容必须放在组件内');
  root.setAttribute('data-editor-component','diagram');root.style.fontFamily='system-ui, -apple-system, "Microsoft YaHei", sans-serif';root.style.boxSizing='border-box';
  const svgs=[...root.querySelectorAll('svg')];if(!svgs.length)bad('图解缺少 SVG');
  const ids=new Map();for(const n of [root,...root.querySelectorAll('[id]')].filter(n=>n.id)){if(ids.has(n.id))bad('图解含重复 ID');ids.set(n.id,prefix+'-'+ids.size);}
  const warnings=[];
  for(const svg of svgs){
   if(!svg.getAttribute('viewBox')||svg.viewBox.baseVal.width<=0||svg.viewBox.baseVal.height<=0)bad('SVG 缺少有效 viewBox');
   for(const tag of ['title','desc'])if(!svg.querySelector(':scope > '+tag)){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);n.textContent=tag==='title'?title:'业务流程、关键规则与待确认事项。';svg.prepend(n);}
   svg.setAttribute('role','img');const labels=[];for(const tag of ['title','desc']){const n=svg.querySelector(':scope > '+tag);if(!n.id)n.id=prefix+'-'+tag+'-'+labels.length+'-'+svgs.indexOf(svg);labels.push(ids.get(n.id)||n.id);}svg.setAttribute('aria-labelledby',labels.join(' '));
   const view=svg.viewBox.baseVal;
   for(const text of svg.querySelectorAll('text')){const b=text.getBBox(),matrix=svg.getScreenCTM().inverse().multiply(text.getScreenCTM()),points=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));if(b.width&&points.some(p=>p.x<view.x-2||p.y<view.y-2||p.x>view.x+view.width+2||p.y>view.y+view.height+2))bad('SVG 文字超出画布，请调整排版后重试');}
   const shapes=[...svg.querySelectorAll('rect')].map(n=>n.getBoundingClientRect());
   for(const text of svg.querySelectorAll('text')){const t=text.getBoundingClientRect();for(const r of shapes)if(r.width>30&&r.height>20&&t.x+t.width/2>=r.x&&t.x+t.width/2<=r.right&&t.y+t.height/2>=r.y&&t.y+t.height/2<=r.bottom&&(t.x<r.x-2||t.right>r.right+2||t.y<r.y-2||t.bottom>r.bottom+2))warnings.push('部分文字可能超出节点边框，请检查预览。');}
  }
  // Copy only authored declarations, with the stylesheet cascade resolved before
  // removing selectors. Keeping percentage/auto dimensions avoids freezing SVGs.
  const rules=[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules]);
  const inherited=/^(?:font(?:-.+)?|color|line-height|letter-spacing|text-align|white-space|fill|stroke|stroke-width|text-anchor|dominant-baseline|--.+)$/;
  const specificity=selector=>[(selector.match(/#[\w-]+/g)||[]).length,(selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)||[]).length,(selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+(?:\([^)]*\))?/g,'').match(/[a-zA-Z][\w-]*/g)||[]).length];
  const compare=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};
  function declarations(node){
   const values=new Map();
   function add(style,rank){for(const authored of style){
    if(authored.startsWith('--')||/var\s*\(/i.test(style.getPropertyValue(authored)))bad('图解不支持 CSS 变量，请使用具体样式值');
    let property=authored;
    if(property==='background'){
     if(style.getPropertyValue('background-image')&&style.getPropertyValue('background-image')!=='none')bad('图解禁止 CSS 图片资源');
     property='background-color';
    }
    if(!safeProperties.has(property)){
     if(['background-image','list-style-image','filter','backdrop-filter','mask','mask-image','-webkit-mask','-webkit-mask-image','border-image','border-image-source','cursor'].includes(property)&&!['none','auto','initial',''].includes(style.getPropertyValue(property).trim()))bad('图解包含不支持的资源样式：'+property);
     continue;
    }
    validateCSS(style.getPropertyValue(property));const candidate={value:style.getPropertyValue(property),priority:style.getPropertyPriority(property),rank:[style.getPropertyPriority(property)==='important'?1:0,...rank]};if(!values.has(property)||compare(candidate.rank,values.get(property).rank)>=0)values.set(property,candidate);}}
   rules.forEach((rule,index)=>{if(!rule.selectorText||!rule.style)bad('图解只支持静态 CSS 样式规则');for(const selector of rule.selectorText.split(','))if(node.matches(selector))add(rule.style,[0,...specificity(selector),index]);});
   add(node.style,[1,0,0,0,rules.length]);return values;
  }
  const snapshots=[root,...root.querySelectorAll('*')].filter(n=>n.localName!=='style').map(n=>[n,declarations(n)]);
  const rootValues=snapshots[0][1];
  for(let ancestor=root.parentElement;ancestor;ancestor=ancestor.parentElement)for(const [property,value]of declarations(ancestor))if(inherited.test(property)&&!rootValues.has(property))rootValues.set(property,value);
  for(const [node,values]of snapshots){node.removeAttribute('style');for(const [property,{value,priority}]of values)node.style.setProperty(property,value,priority);}
  for(const n of [root,...root.querySelectorAll('[id]')].filter(n=>n.id))if(ids.has(n.id))n.id=ids.get(n.id);
  for(const n of [root,...root.querySelectorAll('*')])for(const a of [...n.attributes]){let value=a.value;for(const [old,id] of ids){value=value.replace(urlPattern,(match,quote,fragment)=>fragment.slice(1)===old?'url(#'+id+')':match);if(['aria-labelledby','aria-describedby'].includes(a.name))value=value.split(/\s+/).map(v=>v===old?id:v).join(' ');}n.setAttribute(a.name,value);}
  document.querySelectorAll('style').forEach(n=>n.remove());
  return {component:root.outerHTML,warnings:[...new Set(warnings)]};
 },{title,prefix:'diagram-'+randomUUID()});
 result.component=await page.evaluate(normalizeDiagramDocument);
 result.layoutIssues=await page.evaluate(inspectDiagramLayout);
 if(Buffer.byteLength(result.component)>180000)throw fail('图解组件超过 180KB，请简化内容');
 const escaped=title.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return {...result,html:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+escaped+'</title></head><body style="margin:0;padding:24px;background:#f8fafc">'+result.component+'</body></html>'};
 }catch(error){throw fail(error.message);}finally{await browser.close();}
}
