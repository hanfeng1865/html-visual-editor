import test from 'node:test';
import assert from 'node:assert/strict';
const {parseLogicNote,applyLogicNoteEdits}=await import('../logic-note-document.mjs').catch(()=>({}));
test('visual additions preserve tabs, text, lists and custom table columns after reopening',async()=>{
 const {serializeLogicNote}=await import('../logic-note-document.mjs');
 const model={topics:[{title:'新增账单',groups:[
  {kind:'paragraph',title:'说明',items:[{text:'第一句；第二句。'}]},
  {kind:'list',title:'操作',items:[{text:'点击新增；保留同一条。'},{text:''}]},
  {kind:'rules',title:'填写规则',columns:['字段','规则','备注'],items:[{cells:['月份','必填 | 可选\\项','<script>示例</script>']},{cells:['','','']},{cells:['---','---','---']}]}
 ]},{title:'新 Tab',groups:[]}]};
 const loaded=parseLogicNote(serializeLogicNote(model));
 assert.deepEqual(loaded.topics.map(t=>t.title),['新增账单','新 Tab']);
 assert.equal(loaded.topics[0].groups[0].kind,'paragraph');
 assert.deepEqual(loaded.topics[0].groups[1].items.map(i=>i.text),['点击新增；保留同一条。','']);
 assert.deepEqual(loaded.topics[0].groups[2].columns,['字段','规则','备注']);
 assert.deepEqual(loaded.topics[0].groups[2].items.map(i=>i.cells),model.topics[0].groups[2].items.map(i=>i.cells));
 assert.equal(serializeLogicNote(loaded),serializeLogicNote(model));
});
test('structured business headings produce topics and field rules without changing the original',()=>{
 assert.equal(typeof parseLogicNote,'function');
 const raw='【基本资料】\n操作：打开新增车辆抽屉。\n字段：车牌号｜必填，不区分大小写去重。\n【维保台账】\n操作：支持添加、修改和删除记录。\n字段：费用｜必填，非负数，最多两位小数。\n保存：随车辆档案统一保存。';
 const doc=parseLogicNote(raw);
 assert.deepEqual(doc.topics.map(t=>t.title),['基本资料','维保台账']);
 assert.equal(doc.topics[1].groups.find(g=>g.kind==='rules').items[0].label,'费用');
 assert.equal(doc.topics[1].groups.find(g=>g.title==='保存规则').items[0].text,'随车辆档案统一保存。');
 assert.equal(doc.raw,raw);
});
test('legacy operation and validation paragraphs are grouped into business topics, retaining clauses',()=>{
 const raw='操作：点击后打开新增车辆抽屉，默认进入基本资料。\n校验：车牌号必填，最长20字符。\n校验：保养公里数为非负整数，剩余保养公里数允许填写负整数。\n操作：维保台账支持添加和删除；送修公里数不覆盖当前里程。\n校验：登记维保记录须填写有效送修日期。\n校验：初始里程和累计里程均须为非负整数。';
 const doc=parseLogicNote(raw);
 assert.deepEqual(doc.topics.map(t=>t.title),['基本资料','保养提醒','维保台账','里程记录']);
 const displayed=JSON.stringify(doc.topics);
 for(const phrase of ['最长20字符','剩余保养公里数允许填写负整数','送修公里数不覆盖当前里程','有效送修日期'])assert.ok(displayed.includes(phrase));
});
test('unstructured and unsafe-looking notes remain plain text in a single topic',()=>{
 const raw='<img src=x onerror=alert(1)>\n不得删除人工例外。';
 const doc=parseLogicNote(raw);assert.equal(doc.topics.length,1);assert.equal(doc.topics[0].groups[0].items[0].text,'<img src=x onerror=alert(1)>');
});
test('inline edits preserve source order, separators, whitespace and all untouched topics',()=>{
 const raw='【基本资料】\r\n  概述：车辆基础信息。  \r\n字段： 车牌号 ｜ 必填。 ； 费用须非负。\r\n\r\n【里程记录】\r\n操作：添加记录；删除记录。\r\n';
 const model=parseLogicNote(raw),basic=model.topics[0],rules=basic.groups[0].items;
 assert.equal(raw.slice(basic.summaryRange.start,basic.summaryRange.end),'车辆基础信息。');
 assert.equal(raw.slice(rules[0].labelRange.start,rules[0].labelRange.end),'车牌号');
 assert.equal(raw.slice(rules[0].textRange.start,rules[0].textRange.end),'必填。');
 assert.equal(raw.slice(rules[1].textRange.start,rules[1].textRange.end),'须非负。');
 const edits=[{...rules[0].textRange,text:'必填，最长20字。'},{...rules[0].labelRange,text:'车辆牌照'},{...model.topics[1].groups[0].items[1].textRange,text:'允许删除记录。'}];
 assert.equal(applyLogicNoteEdits(raw,edits),raw.replace('车牌号','车辆牌照').replace('必填。','必填，最长20字。').replace('删除记录。','允许删除记录。'));
 assert.equal(applyLogicNoteEdits(raw,[]),raw);
});
test('inferred rules map repeated and unsafe-looking text to the correct original clause',()=>{
 const raw='校验：初始里程须非负；初始里程须非负。\n操作：<img src=x onerror=alert(1)>';
 const model=parseLogicNote(raw),items=model.topics[0].groups[0].items;
 assert.equal(applyLogicNoteEdits(raw,[{...items[1].textRange,text:'允许为零。'}]),'校验：初始里程须非负；初始里程允许为零。\n操作：<img src=x onerror=alert(1)>');
});
