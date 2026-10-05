import test from 'node:test';
import assert from 'node:assert/strict';
import {diffLines,sourceDiffHunks,changedTextParts} from '../source-diff.mjs';

test('distant edits show separate excerpts with real line numbers',()=>{
 const before=Array.from({length:100},(_,i)=>`line ${i+1}`),after=[...before];after[10]='changed eleven';after[80]='changed eighty one';
 const hunks=sourceDiffHunks(before.join('\n'),after.join('\n'));
 assert.equal(hunks.length,2);assert.equal(hunks[0][0].oldLine,9);assert.equal(hunks[1][0].newLine,79);
 assert.ok(hunks.flat().length<=12);assert.ok(!hunks.flat().some(row=>row.text==='line 50'));
});
test('insertions, deletions and repeated lines reconstruct both inputs',()=>{
 for(const [before,after] of [['a\nb\nc','a\nx\nb\nc'],['a\nb\nc','a\nc'],['a\nb\na','b\na\nb'],['','new'],['old',''],['same','same']]){
  const rows=diffLines(before,after);
  assert.equal(rows.filter(r=>r.type!=='add').map(r=>r.text).join('\n'),before);
  assert.equal(rows.filter(r=>r.type!=='remove').map(r=>r.text).join('\n'),after);
 }
 assert.deepEqual(sourceDiffHunks('same','same'),[]);
});
test('long single-line HTML highlights only the changed value and trims remote code',()=>{
 const prefix='<html>'+'.'.repeat(1000)+'<p>',suffix='</p>'+'.'.repeat(1000)+'</html>';
 const parts=changedTextParts(prefix+'200'+suffix,prefix+'128'+suffix);
 assert.equal(parts.changed,'200');assert.ok(parts.prefix.length<=81);assert.ok(parts.suffix.length<=81);
 assert.ok(parts.prefix.startsWith('…'));assert.ok(parts.suffix.endsWith('…'));
});
test('many small random edits reconstruct correctly',()=>{
 let seed=4;const next=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
 for(let i=0;i<200;i++){
  const a=Array.from({length:next()%20},()=>String(next()%5)).join('\n'),b=Array.from({length:next()%20},()=>String(next()%5)).join('\n'),rows=diffLines(a,b);
  assert.equal(rows.filter(r=>r.type!=='add').map(r=>r.text).join('\n'),a);
  assert.equal(rows.filter(r=>r.type!=='remove').map(r=>r.text).join('\n'),b);
 }
});
