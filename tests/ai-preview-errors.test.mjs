import test from 'node:test';
import assert from 'node:assert/strict';
import {compareAIErrors} from '../ai-editor.mjs';

test('preview validation separates inherited errors from newly introduced errors',()=>{
  const original={kind:'script',message:'isPerson is not defined',url:'http://localhost/ai-baseline/id/index.html'};
  const inherited={...original,url:'http://localhost/ai-preview/id/index.html'};
  const added={kind:'script',message:'AI regression',url:inherited.url};
  assert.deepEqual(compareAIErrors([inherited,added],[original]),{inherited:[inherited],introduced:[added]});
});

test('baseline does not hide repeated errors or a different broken resource',()=>{
  const original={kind:'resource',message:'IMG 加载失败',url:'http://localhost/ai-baseline/id/existing.png'};
  const inherited={...original,url:'http://localhost/ai-preview/id/existing.png'};
  const added={...inherited,url:'http://localhost/ai-preview/id/new.png'};
  assert.deepEqual(compareAIErrors([inherited,inherited,added],[original]),{inherited:[inherited],introduced:[inherited,added]});
});

test('new script and promise failures remain blocking when the baseline is clean',()=>{
  const errors=[{kind:'script',message:'Broken code',url:''},{kind:'promise',message:'Rejected',url:''}];
  assert.deepEqual(compareAIErrors(errors,[]),{inherited:[],introduced:errors});
});
