import test from 'node:test';
import assert from 'node:assert/strict';
import {isNonProductQuestion,pruneNonProductQuestions} from '../requirements-question-policy.mjs';
test('drops content provenance, resource planning and routine presentation confirmations',()=>{
 for(const text of ['Q007 | 资源：本次迭代可投入的预算是多少？','Q008 | 资源：本次迭代已安排哪些交付资源？','Q010 | 首页主视觉：品牌名称、主标题、介绍及标语的权威内容依据是什么？','Q016 | 关于我们：当前主标题“保持好奇，创造”是否是拟发布的最终文案？','Q011 | 首页图形：是否沿用首页“地球”已确认标注中的固定代码展示方案？','Q006 | 产品端：本次网站需要支持哪些浏览设备或承载环境？'])assert.equal(isNonProductQuestion(text),true,text);
 for(const text of ['订单金额的计算公式是什么？','上传图片超过预算限制时如何提示？','Safari 上提交表单失败时如何处理？','首页服务卡片点击后进入哪个业务流程？','团队成员可以修改哪些字段？'])assert.equal(isNonProductQuestion(text),false,text);
});
test('archives obsolete pending questions while preserving answers, document and snapshots',()=>{
 const irrelevant='首页服务卡片：品牌设计卡片的权威内容依据是什么？',valid='统计是否去重？';
 const state={iterations:[{status:'active',document:'原文待回答 Q012',questions:[irrelevant,valid],interviews:[{questions:[{id:'a',text:irrelevant,status:'pending'},{id:'b',text:irrelevant,status:'answered',answer:'人工回答'},{id:'c',text:valid,status:'pending'}]}],documentReviews:[{status:'pending',result:{questions:[irrelevant,valid]}}],completions:[{questions:[irrelevant]}]}]};
 pruneNonProductQuestions(state);const it=state.iterations[0];assert.deepEqual(it.questions,[valid]);assert.deepEqual(it.interviews[0].questions.map(q=>q.id),['b','c']);assert.deepEqual(it.documentReviews[0].result.questions,[valid]);assert.equal(it.document,'原文待回答 Q012');assert.equal(it.completions[0].questions.length,1);assert.ok(it.excludedQuestions.some(q=>q.text===irrelevant));
 pruneNonProductQuestions(state);assert.equal(it.excludedQuestions.length,1);
});
