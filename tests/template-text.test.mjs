import test from 'node:test';import assert from 'node:assert/strict';import {staticTemplateLeaves,encodeTemplateText} from '../template-text.mjs';
test('finds a visible label without matching business identifiers, comments or interpolation strings',()=>{
 const script='// <span>Comment</span>\nconst ids=["今日应收"]; host.innerHTML=\x60<button data-title="今日应收"><span>今日应收</span><b>'+'\x24{value}'+'</b></button>\x60; /* \x60<span>Ignored</span>\x60 */';
 assert.deepEqual(staticTemplateLeaves(script),[{tag:'span',needle:'<span>今日应收</span>',rawText:'今日应收'}]);
});
test('handles nested template expressions and quoted HTML, and escapes text as data',()=>{
 assert.equal(staticTemplateLeaves('const a=\x60<div>\x24{items.map(x=>\x60<span>Nested label</span>\x60)}</div>\x60;const b="<p>Quoted label</p>";').length,2);
 assert.equal(encodeTemplateText('<script>\x24{run()}\x60\\\n'),'&lt;script&gt;&#36;{run()}&#96;&#92;&#10;');
});
