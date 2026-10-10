// Exclude routine content approval and project staffing from product-rule interviews.
// Deliberately narrow: specific compatibility defects and business limits remain questions.
export const PRODUCT_QUESTION_INSTRUCTION=`提问边界：用户是产品经理。只追问会改变功能范围、业务流程、交互结果、权限、数据口径、状态异常或验收结论的具体缺口；每题须说明会影响哪项产品决策。静态品牌名称、标题、标语、介绍、服务卡片、理念和 FAQ 文案默认沿用原型，注明“沿用当前原型，文案可后续替换”，不要逐条问含义、权威依据、是否最终发布或是否沿用。既有装饰图形和已明确展示方案直接沿用，不要求确认实现技术。不要默认追问项目预算、人天、人员和交付资源；How much 缺信息写“本轮未提供，由项目管理补充，不阻塞功能需求”。不要把浏览器、设备和部署环境变成例行必答题；存在具体业务兼容性风险或用户明确要求时才问。纯展示内容不套用数据字段、公式、来源系统的规则；业务数据和交互仍逐项澄清。用户明确要求修改文案或安排资源时，按本轮要求处理，不能自行改变已有文案或编造资源承诺。`;
export function isNonProductQuestion(text){
 if(typeof text!=='string')return false;
 return /权威内容依据|(?:文案|标语|品牌名称).*权威依据/.test(text)
  ||/(?:标题|标语|文案).*(?:拟发布|最终文案|最终发布)/.test(text)
  ||/(?:本次|本轮|这次).*(?:迭代|项目).*(?:投入的预算|预算是多少|安排哪些交付资源|交付资源有哪些|多少人天|投入多少人)/.test(text)
  ||/是否沿用.*(?:地球|装饰|图形).*(?:展示方案|代码)/.test(text)
  ||/需要支持哪些(?:浏览设备|浏览器|设备或承载环境)/.test(text);
}
export function pruneNonProductQuestions(state){
 for(const it of state.iterations||[]){
  if(it.status!=='active'&&it.status!=='pending')continue;
  const archive=text=>{it.excludedQuestions??=[];if(!it.excludedQuestions.some(q=>q.text===text))it.excludedQuestions.push({text,reason:'不属于待澄清的产品规则，沿用现有展示或由项目管理补充'});};
  const keep=text=>{if(!isNonProductQuestion(text))return true;archive(text);return false;};
  it.questions=(it.questions||[]).filter(keep);
  for(const round of it.interviews||[])round.questions=round.questions.filter(q=>q.status==='answered'||keep(q.text));
  for(const review of it.documentReviews||[])if(review.status==='pending'&&Array.isArray(review.result?.questions))review.result.questions=review.result.questions.filter(keep);
 }
 return state;
}
