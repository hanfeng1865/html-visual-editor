// Group functional instances, retaining raw members and all their rule differences.
// This function is also serialized into the read-only share page: keep it self-contained.
export function groupRepeatedPRDItems(doc,items){
 const groups=[],scopes=new Map(),elements=new Map();
 const normalize=value=>(value||'').replace(/\s+/g,' ').trim();
 const controls='button,a[href],input,select,textarea,[role="button"],[role="switch"],[role="checkbox"]';
 for(const item of items){
  let target;try{target=doc.querySelector(item.selector);}catch{}
  let scope=null,signature='',label=normalize(target?.getAttribute('aria-label')||target?.getAttribute('placeholder')||target?.textContent),kind='control';
  const tree=target?.closest('[role="tree"],.tree-list');
  if(tree&&target.matches(controls+', [role="treeitem"]')){
   // Selection and expansion belong to the same directory, not to each sample node.
   scope=tree;signature='tree';label='目录选择与展开';kind='tree';
  }else if(target?.matches(controls)){
   const row=target.closest('tr,[role="row"],li,[role="listitem"]');
   const list=row?.closest('table,[role="table"],[role="grid"],ul,ol,[role="list"]');
   const cell=target.closest('td,th,[role="cell"],[role="gridcell"]');
   const column=cell&&row?[...row.children].indexOf(cell):0;
   if(target.matches('input,select,textarea'))label=normalize(target.getAttribute('aria-label')||target.getAttribute('placeholder')||target.labels?.[0]?.textContent);
   // Explicit action destinations are stronger than record names or sample numbers.
   // Restrict to the same list/parent so separate modules never merge by destination alone.
   const action=[...target.attributes].filter(a=>/^data-(?:[\w-]+-)?(?:detail|action|open)$/.test(a.name)).map(a=>a.name+'='+a.value).sort().join('|');
   scope=list|| (action?target.parentElement:null);
   if(scope)signature=[target.localName,target.getAttribute('role')||'',target.getAttribute('type')||'',column,action||label].join('|');
   if(action){kind='function';label='同一功能入口';}
  }
  // CSS aliases and annotation categories do not create a second pin on one element.
  let group=target?elements.get(target):null;
  if(!group&&scope&&signature){
   let map=scopes.get(scope);if(!map){map=new Map();scopes.set(scope,map);}
   group=map.get(signature);
   if(!group){group={item,members:[],selectors:[],label,kind};map.set(signature,group);groups.push(group);}
  }
  if(!group){group={item,members:[],selectors:[],label,kind};groups.push(group);}
  if(target)elements.set(target,group);
  group.members.push(item);
  for(const selector of item.selectors||[item.selector])if(!group.selectors.includes(selector))group.selectors.push(selector);
 }
 return groups;
}

// Shared, deterministic block planning for collection, legacy annotations and shares.
// Never mutate source items; merging only changes their display parent and anchor.
export function groupPRDBlocks(doc,items,{limit=15}={}){
 const groups=[],byAnchor=new Map(),win=doc.defaultView;
 const views='[role="tabpanel"],[data-panel],.tab-pane,.tab-panel,.module-panel,[data-detail],dialog,[role="dialog"],.drawer,.detail-drawer';
 const controls='button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="switch"]';
 const normalize=value=>(value||'').replace(/\s+/g,' ').trim();
 function selector(el){
  if(el.id&&doc.querySelectorAll('#'+win.CSS.escape(el.id)).length===1)return '#'+win.CSS.escape(el.id);
  const path=[];for(let e=el;e&&e!==doc.documentElement;e=e.parentElement){
   if(e.id){path.unshift('#'+win.CSS.escape(e.id));break;}
   const siblings=[...(e.parentElement?.children||[])].filter(n=>n.tagName===e.tagName);
   path.unshift(e.localName+`:nth-of-type(${siblings.indexOf(e)+1})`);
  }return path.join(' > ');
 }
 const named=el=>el?.matches('section,article,aside,header,nav,form,fieldset,table,ul,ol,[role="table"],[role="grid"],[role="list"],[role="tree"],[role="tablist"],[data-prd-block],[data-prd-region],[role="region"],[role="img"],canvas')||/(?:^|[\s-])(?:card|panel|widget|chart|list|filters?|tabs|controls|actions|alert|toolbar|segmented|metrics|kpis|summary|roles|section|rank-head|rank-content|profile-group)(?:$|[\s-])/.test(el?.getAttribute('class')||'')||/rank-content$/.test(el?.id||'');
 function blockFor(el){
  // Explicitly authored blocks and independent behavior take precedence.
  const explicit=el.closest('[data-prd-block],[data-prd-independent]');if(explicit)return explicit;
  const table=el.closest('table,[role="table"],[role="grid"]');if(table)return table;
  const tree=el.closest('[role="tree"],aside.tree,.tree-list');if(tree)return tree.closest('aside')||tree;
  // A directory/form/toolbar owns its field labels and controls.
  const form=el.closest('form,fieldset');if(form)return form;
  const chartCard=el.closest('article,.chart-card');if(chartCard?.querySelector('[role="img"],canvas,svg[data-chart]'))return chartCard;
  const overtime=el.closest('.ha-overtime-rank-head');if(overtime)return overtime;
  let block=el;
  if(el.matches(controls)||!named(el))block=el.parentElement;
  while(block&&block!==doc.body&&!named(block)&&!block.matches(views))block=block.parentElement;
  block??=el;
  if(block.matches(views)&&block!==el&&el.parentElement!==doc.body)block=el.parentElement;
  // Homogeneous metric cards form one indicator group, even with different data values.
  const metric=/(?:metric|kpi|stat)[- ]?card|ha-metric|ha-business-role|ha-structure-kpi/.test(el.getAttribute('class')||'');
  if(metric&&el.parentElement&&[...el.parentElement.children].filter(c=>c.localName===el.localName&&c.classList[0]===el.classList[0]).length>1)block=el.parentElement;
  if(block.matches('article,.metric-card,.kpi-card,.stat-card')&&block.parentElement&&(/(?:metrics|kpis|stats)/.test(block.parentElement.getAttribute('class')||'')||block.matches('.metric-card,.kpi-card,.stat-card'))&&[...block.parentElement.children].filter(c=>c.matches('article,.metric-card,.kpi-card,.stat-card')).length>1)block=block.parentElement;
  // Never place a pin on body just because the page lacks semantic wrappers.
  return block===doc.body?el:block;
 }
 function label(el){
  const heading=el.querySelector('h1,h2,h3,h4,h5,h6,.ha-block-head b,.ha-rank-head-copy b,.ha-honor-title');
  let title=el.getAttribute('aria-label')||heading?.textContent||[...el.children].find(c=>c.matches('b,strong'))?.textContent||el.getAttribute('data-prd-block');
  if(!title)title=el.parentElement?.querySelector('h1,h2,h3,h4,h5,h6,.ha-block-head b')?.textContent;
  const name=(el.getAttribute('class')||'')+' '+el.id;
  const suffix=/filter|controls|tabs|rank-head/.test(name)?'筛选条':/chart|rank-content/.test(name)?'图表':el.matches('table')?'数据表':'';
  return (normalize(title||el.id||el.textContent).slice(0,60)+(suffix?' · '+suffix:'')).slice(0,100)||'功能区块';
 }
 function viewFor(el,item){const view=el.closest(views);return view?selector(view):(item.scope||'');}
 for(const item of items){
  let el;try{el=doc.querySelector(item.selector);}catch{}
  if(!el){groups.push({item,members:[item],selectors:item.selectors||[item.selector],label:item.title||'未显示区块',kind:'block',view:item.scope||'',anchor:null});continue;}
  // Decorative headings/copy never generate a new block on their own.
  if(!item.content&&!item.required&&el.matches('h1,h2,h3,h4,h5,h6,p,span'))continue;
  const anchor=item.granularity==='block'?el:blockFor(el),view=viewFor(el,item);
  let maps=byAnchor.get(anchor);if(!maps){maps=new Map();byAnchor.set(anchor,maps);}
  let group=maps.get(view);if(!group){group={item,members:[],selectors:[],label:label(anchor),kind:'block',view,anchor};maps.set(view,group);groups.push(group);}
  group.members.push(item);for(const s of item.selectors||[item.selector])if(!group.selectors.includes(s))group.selectors.push(s);
 }
 function ancestor(a,b){let el=a;while(el&&!el.contains(b))el=el.parentElement;return el;}
 function combine(selected,anchor){
  const first=selected[0];first.anchor=anchor;first.label=label(anchor);
  first.members=selected.flatMap(g=>g.members);first.selectors=[...new Set(selected.flatMap(g=>g.selectors))];
  for(const g of selected.slice(1))groups.splice(groups.indexOf(g),1);
 }
 function mergeParent(a,b){const parent=ancestor(a.anchor,b.anchor);if(!parent||parent===doc.documentElement)return false;combine(groups.filter(g=>g.view===a.view&&g.anchor&&parent.contains(g.anchor)),parent);return true;}
 // Parent coverage and near/overlapping anchors merge upward, before pin layout.
 let changed=true;while(changed){changed=false;
  outer:for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
   const a=groups[i],b=groups[j];if(a.view!==b.view||!a.anchor||!b.anchor)continue;
   const contains=a.anchor.contains(b.anchor)||b.anchor.contains(a.anchor);
   const r=a.anchor.getBoundingClientRect(),s=b.anchor.getBoundingClientRect();
   const area=Math.min(r.width*r.height,s.width*s.height),overlap=Math.max(0,Math.min(r.right,s.right)-Math.max(r.left,s.left))*Math.max(0,Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top));
   const near=area>0&&(Math.hypot(r.left-s.left,r.top-s.top)<40||overlap/area>.5);
   if(contains||near){if(mergeParent(a,b)){changed=true;break outer;}}
  }
 }
 // Common navigation counts towards each Tab's budget. Hidden panels get their own budget.
 const commonCount=()=>groups.filter(g=>!g.view).length;
 for(const view of [...new Set(groups.map(g=>g.view))]){
  const budget=()=>view?Math.max(1,limit-commonCount()):limit;
  while(groups.filter(g=>g.view===view).length>budget()){
   const candidates=groups.filter(g=>g.view===view&&g.anchor);let best=null;
   for(const g of candidates){for(let parent=g.anchor.parentElement;parent&&parent!==doc.documentElement;parent=parent.parentElement){
    const children=candidates.filter(c=>parent.contains(c.anchor));if(children.length<2)continue;
    const names=children.map(c=>(c.anchor.getAttribute('class')||'')+' '+c.anchor.id);
    const score=children.length+(names.some(n=>/filter|controls|tabs|rank-head/.test(n))&&names.some(n=>/chart|rank-content/.test(n))?100:0); // Keep chart/filter subdivision where another upward merge can meet the budget.
    if(!best||score<best.score)best={children,parent,score};break;
   }}
   if(!best)break;combine(best.children,best.parent);
  }
 }
 groups.sort((a,b)=>a.anchor&&b.anchor?(a.anchor.compareDocumentPosition(b.anchor)&win.Node.DOCUMENT_POSITION_FOLLOWING?-1:a.anchor===b.anchor?0:1):0);
 return groups.map(g=>{
  const anchor=g.anchor?selector(g.anchor):g.item.selector;
  const selectors=[...new Set([anchor,...g.selectors])];
  const source=g.item;
  return {...g,item:{...source,selector:anchor,selectors,scope:g.view,scopeTitle:source.scopeTitle||g.view||'公共区域'},selectors,anchor:undefined,label:g.label,childCount:g.members.length};
 });
}
