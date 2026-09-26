export const CARD_SELECTOR = '.ha-metric,.ha-overtime-card,.ha-care,.ha-business-role,.ha-month-risk-item,.ha-list-item,.finance-kpi,.finance-stat,.procurement-metric,.live-card,.accounting-card';
export const STYLE_PROPERTIES = ['fontSize','fontWeight','fontStyle','textDecorationLine','fontFamily','lineHeight','color','textAlign','backgroundColor','borderRadius','opacity','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle','borderColor','boxShadow'];
export const ICON_CHOICES = [['users','人员'],['calendar-days','日历'],['timer','计时'],['clock','时钟'],['circle-check','完成'],['triangle-alert','提醒'],['briefcase-business','工作'],['trending-up','增长'],['heart','关怀'],['gift','礼物'],['trophy','荣誉']];
export const IMAGE_CHOICES = ['collection.png','customers.png','dashboard.png','declared.png','details.png','ordered.png','pending.png','profit.png','receivable.png','retained.png'];

export function elementLabel(element) {
  if (element.matches('body')) return '页面';
  if (element.matches('.ha-section,.ha-topic')) return element.querySelector('h2,h3,h4')?.textContent.trim().slice(0,22) || '内容板块';
  if (element.matches('main')) return '主内容';
  if (element.matches('.app')) return '驾驶舱页面';
  if (element.matches('.cockpit-view')) return { 'cockpit-human-admin':'人力行政驾驶舱','cockpit-operating':'经营驾驶舱','cockpit-procurement':'采购驾驶舱','cockpit-finance':'财务驾驶舱' }[element.id] || '驾驶舱';
  if (element.matches('.panel')) return element.querySelector('h2,h3,.panel-title')?.textContent.trim().slice(0,22) || '内容板块';
  if (element.matches(CARD_SELECTOR)) return '卡片 · ' + (element.querySelector('.ha-metric-top,.ha-overtime-head,.label,.procurement-metric-label')?.textContent || element.textContent).trim().replace(/\s+/g,' ').slice(0,20);
  if (element.matches('.ha-attendance-daily')) return '考勤概览';
  if (element.matches('.ha-attendance-subhead')) return '日期与标题';
  if (element.matches('.ha-live-grid,.live-grid')) return '指标卡片组';
  if (element.matches('.ha-metric-top,.ha-overtime-head,.label')) return '标题';
  if (element.matches('.ha-metric-main,.ha-overtime-summary')) return '数值区域';
  if (element.matches('strong,.value')) return '数值';
  if (element.matches('.ha-metric-chip')) return '状态标签';
  if (element.matches('small,.unit')) return '单位 / 辅助文字';
  if (element.matches('em')) return '说明';
  if (element.matches('svg,img,.ha-metric-icon,.ha-overtime-icon')) return '图标';
  if (element.matches('.drawer')) return '详情弹窗';
  const text = element.textContent.trim().replace(/\s+/g,' ').slice(0,22);
  if (!text && element.matches('td,th')) return '表格单元格';
  return text || ({ DIV:'容器',SPAN:'内容',BUTTON:'按钮',SECTION:'板块' }[element.tagName] || '元素');
}

export function textTargetsForElement(element, doc) {
  if(element.matches('button,a,[role="button"]') && element.childElementCount>0) {
    const walker=doc.createTreeWalker(element,4),targets=[];
    for(let node=walker.nextNode();node;node=walker.nextNode()) {
      const value=node.textContent.trim();
      if(!value || /^[↗↖↘↙→←↑↓➜➔›»]+$/.test(value) || node.parentElement.closest('svg,i,[aria-hidden="true"],[data-lucide],.icon,.material-icons,script,style'))continue;
      targets.push({element:node.parentElement,index:[...node.parentElement.childNodes].indexOf(node),value});
    }
    return targets;
  }
  if(element.childElementCount || element.matches('img,svg,svg *,hr,input,textarea,select,video,audio,canvas,iframe,object,embed'))return [];
  if(!element.textContent.trim() && !element.matches('h1,h2,h3,h4,h5,h6,p,span,strong,b,small,em,label,button,a,td,th'))return [];
  return [{element,index:null,value:element.textContent.trim()}];
}

export function contentFields(card) {
  const result=[];
  for (const element of [card,...card.querySelectorAll('*')]) {
    if (element.closest('[data-ve-dynamic]')) continue;
    if (element.closest('svg,script,style,template') || element.closest('[hidden]')) continue;
    if (!element.getClientRects().length) continue;
    [...element.childNodes].forEach((node,index)=>{
      if(node.nodeType!==3 || !node.textContent.trim()) return;
      let label='文字';
      if (element.matches('.ha-metric-top,.label,.procurement-metric-label') || element.parentElement?.matches('.ha-overtime-head')) label='标题';
      else if (element.matches('.ha-metric-chip')) label='标签';
      else if(element.matches('strong,.value,.procurement-metric-value')) label='数值';
      else if(element.matches('small,.unit') && element.parentElement?.matches('strong,.value')) label='单位';
      else if(element.matches('em') || element.matches('[class*="foot"], [class*="note"]')) label='说明';
      else if(element.matches('b') && element.closest('.ha-care-copy')) label='内容';
      else if(result.length===0) label='标题';
      const group=element.closest('.ha-overtime-detail');
      if(group) label=(group.classList.contains('unapplied')?'未申请 · ':'已申请 · ')+label;
      result.push({element,index,label,value:node.textContent.trim(),leaf:element.childElementCount===0});
    });
  }
  const counts=new Map();
  for(const field of result) {const n=(counts.get(field.label)||0)+1;counts.set(field.label,n);if(n>1)field.label+=` ${n}`;}
  return result;
}
