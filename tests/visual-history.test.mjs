import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeVisualEdits,readVisualEdits,listVisualHistory,restoreVisualHistory} from '../visual-edits-store.mjs';
const version=text=>({version:1,patches:{title:{selector:'#title',text}}});
test('history merges identical snapshots and describes their contents without deleting backups',async()=>{
  const root=await mkdtemp(join(tmpdir(),'history-dedup-'));
  const paths={filePath:join(root,'visual-edits.json'),backupDir:join(root,'backups')};
  try {
    await writeVisualEdits({...paths,value:{version:1,patches:{}}});
    await writeVisualEdits({...paths,value:version('Our services')});
    await writeVisualEdits({...paths,value:version('Our services')});
    const list=await listVisualHistory(paths);
    assert.equal(list.length,1);assert.equal(list[0].id,'current');
    assert.match(list[0].summary,/Our services/);
    assert.equal((await readdir(paths.backupDir)).length,2);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('restore keeps unsaved draft and saved version recoverable, including after reset',async()=>{
  const root=await mkdtemp(join(tmpdir(),'history-test-'));
  const paths={filePath:join(root,'visual-edits.json'),backupDir:join(root,'backups')};
  try{
    assert.deepEqual(await listVisualHistory(paths),[]);
    await writeVisualEdits({...paths,value:version('one')});
    await writeVisualEdits({...paths,value:version('two')});
    const old=(await listVisualHistory(paths)).find(item=>item.id!=='current');
    await restoreVisualHistory({...paths,id:old.id,draft:version('unsaved')});
    assert.deepEqual(await readVisualEdits(paths.filePath),version('one'));
    const draft=(await listVisualHistory(paths)).find(item=>item.beforeRestore);
    await restoreVisualHistory({...paths,id:'original',draft:version('one')});
    assert.deepEqual((await readVisualEdits(paths.filePath)).patches,{});
    await restoreVisualHistory({...paths,id:draft.id,draft:{version:1,patches:{}}});
    assert.deepEqual(await readVisualEdits(paths.filePath),version('unsaved'));
    const before=await readdir(paths.backupDir);
    await assert.rejects(restoreVisualHistory({...paths,id:'../other.json',draft:version('x')}));
    await assert.rejects(restoreVisualHistory({...paths,id:'visual-edits-missing.json',draft:version('x')}));
    assert.deepEqual(await readdir(paths.backupDir),before);
    assert.deepEqual(await readVisualEdits(paths.filePath),version('unsaved'));
  }finally{await rm(root,{recursive:true,force:true});}
});
