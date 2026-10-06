import test from 'node:test';
import assert from 'node:assert/strict';
import {removeDocumentSection,documentOutline} from '../requirements-body-editor.mjs';
const document='# 标题\n\n前言\n\n## 一\n\n第一章\n\n### 子节\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n## 二\n\n第二章\n\n## 三\n\n第三章';
test('deleting a chapter includes its subsections and table, leaving neighbors intact',()=>{
 const result=removeDocumentSection(document,0);assert.equal(result,'# 标题\n\n前言\n\n## 二\n\n第二章\n\n## 三\n\n第三章');
});
test('deleting the final chapter retains the previous chapter body',()=>{
 const result=removeDocumentSection(document,2);assert.ok(result.endsWith('第二章'));assert.equal(documentOutline(result).length,2);
});
test('middle chapter deletion keeps preceding and following content',()=>{
 const result=removeDocumentSection(document,1);assert.ok(result.includes('| 1 | 2 |'));assert.ok(result.endsWith('第三章'));assert.ok(!result.includes('第二章'));
});
test('missing chapters are unchanged and lower-level outlines are supported',()=>{
 assert.equal(removeDocumentSection(document,12),document);assert.equal(removeDocumentSection('# 文档\n\n### 子节一\n内容\n\n### 子节二\n保留',0),'# 文档\n\n### 子节二\n保留');
});
