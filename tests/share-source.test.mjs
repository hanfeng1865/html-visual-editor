import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';

const script=fileURLToPath(new URL('../share-source.mjs',import.meta.url));
async function fixture(callback) {
  const root=await mkdtemp(join(tmpdir(),'safe-share-'));
  try {
    execFileSync('git',['init','-q'],{cwd:root});
    await writeFile(join(root,'index.html'),'<p>Public demo</p>');
    await callback(root);
  } finally {await rm(root,{recursive:true,force:true});}
}
function commit(root) {
  execFileSync('git',['add','-f','.'],{cwd:root});
  execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture'],{cwd:root});
}
function pack(root) {return spawnSync(process.execPath,[script,join(root,'share.zip')],{cwd:root,encoding:'utf8'});}

test('source ZIP excludes private files even when force committed',async()=>fixture(async root=>{
  await mkdir(join(root,'.editor-workspaces'));
  await writeFile(join(root,'.editor-workspaces/ai-config.json'),JSON.stringify({apiKey:'private-fixture-key'}));
  await writeFile(join(root,'.env'),'KEY=private-fixture-key');
  await writeFile(join(root,'editor-config.json'),'{}');
  commit(root);
  const result=pack(root);
  assert.equal(result.status,0,result.stderr);
  const listing=execFileSync('unzip',['-Z1',join(root,'share.zip')],{encoding:'utf8'});
  assert.match(listing,/index\.html/);
  assert.doesNotMatch(listing,/ai-config|\.env|editor-config\.json/);
}));

test('source ZIP refuses recognizable credentials without printing them',async()=>fixture(async root=>{
  const secret='sk-'+ 'secretfixture'.repeat(4);
  await writeFile(join(root,'app.js'),`const credential="${secret}";`);
  commit(root);
  const result=pack(root);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/app\.js/);
  assert.ok(!result.stderr.includes(secret));
  await assert.rejects(access(join(root,'share.zip')));
}));

test('source ZIP detects the locally saved key copied into source',async()=>fixture(async root=>{
  const secret='custom-provider-private-fixture';
  await writeFile(join(root,'app.js'),`const credential="${secret}";`);
  commit(root);
  await mkdir(join(root,'.editor-workspaces'));
  await writeFile(join(root,'.editor-workspaces/ai-config.json'),JSON.stringify({apiKey:secret}));
  const result=pack(root);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/app\.js/);
  assert.ok(!result.stderr.includes(secret));
  await assert.rejects(access(join(root,'share.zip')));
}));
