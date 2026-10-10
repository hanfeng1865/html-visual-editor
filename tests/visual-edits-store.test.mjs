import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateVisualEdits, writeVisualEdits } from '../visual-edits-store.mjs';

test('validateVisualEdits accepts selector patches and rejects unsafe shapes', () => {
  const valid = {
    version: 1,
    patches: {
      've-title': { selector: '#title', text: '新标题', styles: { color: '#123456' } },
      've-card': { selector: '.card', position: { parent: '.grid', index: 1 } },
    },
  };

  assert.deepEqual(validateVisualEdits(valid), valid);
  assert.throws(() => validateVisualEdits({ version: 1, patches: { bad: { selector: '#x', scripts: [] } } }), /不支持/);
  assert.throws(() => validateVisualEdits({ version: 1, patches: { bad: { selector: '', text: 'x' } } }), /selector/);
});

test('column span adjustments persist but arbitrary HTML attributes are rejected', () => {
  const value={version:1,patches:{wide:{selector:'#wide',attributes:{colspan:'3'}}}};
  assert.deepEqual(validateVisualEdits(value),value);
  assert.throws(()=>validateVisualEdits({version:1,patches:{bad:{selector:'#bad',attributes:{onclick:'alert(1)'}}}}),/属性/);
});

test('table column rules persist and reject invalid or duplicate column indices', () => {
  const patch={selector:'#table',tableColumns:[{index:1,width:120}]};
  assert.doesNotThrow(()=>validateVisualEdits({version:1,patches:{table:patch}}));
  for(const tableColumns of [[{index:-1,width:10}],[{index:1,width:-10}],[{index:1,width:10},{index:1,width:10}],{}])
    assert.throws(()=>validateVisualEdits({version:1,patches:{table:{...patch,tableColumns}}}));
});

test('input value attributes can be saved without permitting executable attributes', () => {
  assert.doesNotThrow(()=>validateVisualEdits({version:1,patches:{input:{selector:'#input',attributes:{value:'输入内容',placeholder:'请输入客户名称'}}}}));
  assert.throws(()=>validateVisualEdits({version:1,patches:{input:{selector:'#input',attributes:{oninput:'alert(1)'}}}}),/属性/);
});

test('writeVisualEdits backs up the previous file and atomically stores JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'visual-edits-'));
  const filePath = join(root, 'visual-edits.json');
  const backupDir = join(root, '.visual-editor-backups');
  await writeVisualEdits({
    filePath,
    backupDir,
    value: { version: 1, patches: { first: { selector: '#first', text: '一' } } },
    now: new Date('2026-09-22T01:02:03.000Z'),
  });
  await writeVisualEdits({
    filePath,
    backupDir,
    value: { version: 1, patches: { second: { selector: '#second', text: '二' } } },
    now: new Date('2026-09-22T02:03:04.000Z'),
  });

  const stored = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(stored.patches.second.text, '二');
  const backups = await readdir(backupDir);
  assert.equal(backups.length, 1);
  const backup = JSON.parse(await readFile(join(backupDir, backups[0]), 'utf8'));
  assert.equal(backup.patches.first.text, '一');
});
