import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStorage} from '../draft-storage.mjs';

test('legacy drafts and source baselines still persist when IndexedDB is unavailable',async()=>{
  const values=new Map([['html-editor-draft:test:index.html','existing draft']]);
  const storage=await createDraftStorage({
    localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
    indexedDB:{open(){throw new Error('IndexedDB disabled');}},
  });
  assert.equal(storage.getItem('html-editor-draft:test:index.html'),'existing draft');
  storage.setItem('html-editor-draft:test:index.html-source-base','original source');
  assert.equal(await storage.flush(),true);
  assert.equal(values.get('html-editor-draft:test:index.html-source-base'),'original source');
});

test('failure of both stores retains the draft in memory and reports failed durability',async()=>{
  const storage=await createDraftStorage({
    localStorage:{getItem:()=>null,setItem(){throw new Error('Quota exceeded');},removeItem(){}},
    indexedDB:{open(){throw new Error('IndexedDB disabled');}},
  });
  storage.setItem('html-editor-draft:test:index.html','unsaved changes');
  assert.equal(storage.getItem('html-editor-draft:test:index.html'),'unsaved changes');
  assert.equal(await storage.flush(),false);
});
