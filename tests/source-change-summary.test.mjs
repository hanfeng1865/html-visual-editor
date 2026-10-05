import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSourceChanges} from '../source-change-summary.mjs';
test('summaries describe changed text and specific layout properties',()=>{
 const before={'index.html':'<button id="action">下载报表</button><article id="card" style="gap:12px;left:10px;width:200px">卡片</article>'};
 const after={'index.html':'<button id="action">导出报表</button><article id="card" style="gap:24px;left:30px;width:220px">卡片</article>'};
 const summary=summarizeSourceChanges(before,after);
 assert.match(summary,/下载报表.*导出报表/);assert.match(summary,/间距/);assert.match(summary,/位置/);assert.match(summary,/尺寸/);
});
test('summaries distinguish components, CSS and interactions without inventing a visual change',()=>{
 assert.match(summarizeSourceChanges({'index.html':'<p id="a">文字</p>'},{'index.html':'<p id="a">文字</p><button id="b">按钮</button>'}),/新增组件/);
 assert.match(summarizeSourceChanges({'styles.css':'.cards{gap:10px}'},{'styles.css':'.cards{gap:20px}'}),/间距/);
 assert.match(summarizeSourceChanges({'app.js':'const value=1'},{'app.js':'const value=2'}),/交互逻辑/);
 assert.equal(summarizeSourceChanges({'index.html':'<p>相同</p>'},{'index.html':'<p>相同</p>'}),'无源码改动');
});

test('unrelated text removal and insertion are not described as a replacement',()=>{
 const summary=summarizeSourceChanges({'index.html':'<span id="old">逾期金额</span>'},{'index.html':'<p id="new">文字</p>'});
 assert.doesNotMatch(summary,/改为/);assert.match(summary,/删除文字/);assert.match(summary,/新增文字/);
});
