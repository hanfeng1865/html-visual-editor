import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryChecklist,deliveryCopy} from '../requirements-delivery.mjs';
const document=['# 示例',...['Why','What','Who','When','Where'].map((v,i)=>`## ${i+1}. ${v}｜说明\n已有描述`),'## 6. How｜逻辑','### 6.1 绩效','#### 6.1.1 完成率','来源：CRM。字段：人员ID。处理公式：实际÷目标。异常：目标0显示不可计算。验收：输入实际10、目标20，期望结果50%。','#### 6.1.2 导入','数据来源：文件。待回答 Q001。','## 7. How much｜资源','待确认预算'].join('\n');
test('delivery identifies leaf functions and distinguishes structure from decisions',()=>{
 const c=deliveryChecklist({document,questions:['Q001 模板？']});assert.deepEqual(c.missingChapters,[]);assert.equal(c.features.length,2);assert.deepEqual(c.features[0].missing,[]);assert.equal(c.features[0].unsettled,false);assert.ok(c.features[1].missing.includes('验收场景'));assert.equal(c.features[1].unsettled,true);assert.equal(c.hasUnsettledText,true);
});
test('handoff includes unanswered, unsynced and conflicting rules without publishing candidates',()=>{
 const it={name:'V1.1',document,questions:['Q001 模板？'],extraAnswers:[{text:'保存方式？',answer:'服务端',status:'answered',needsDocumentSync:true}],documentReviews:[{status:'pending',document:'秘密候选正文'}],conflicts:[{title:'来源冲突',status:'pending',statements:[{source:'旧稿',text:'Excel'},{source:'本轮',text:'CRM'}],explanation:'采用CRM'}]};
 const c=deliveryChecklist(it);assert.equal(c.unsynced.length,1);assert.equal(c.conflicts.length,1);assert.equal(c.reviews.length,1);
 const text=deliveryCopy(it);assert.ok(text.startsWith(document));assert.match(text,/Q001 模板/);assert.match(text,/旧稿 — Excel/);assert.match(text,/尚未写入正文/);assert.match(text,/服务端/);assert.doesNotMatch(text,/秘密候选正文/);
});
test('empty documents and incomplete chapters remain visible',()=>{const c=deliveryChecklist({document:''});assert.equal(c.missingChapters.length,7);assert.equal(c.features.length,0);assert.equal(c.hasDocument,false);assert.match(deliveryCopy({name:'空稿'}),/正文为空/);assert.match(deliveryCopy({name:'空稿'}),/尚未识别/);});
