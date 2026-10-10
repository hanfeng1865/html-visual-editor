import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {mergeSourcePatches} from '../source-runtime.mjs';

const source = await readFile(new URL('../editor.js', import.meta.url), 'utf8');
const prdSource = await readFile(new URL('../prd-annotations-runtime.mjs', import.meta.url), 'utf8');
const bodyOf = name => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\nfunction ', source.indexOf(`function ${name}(`) + 1));

test('saveability updates check actual edits without enumerating the whole page', () => {
  let routed = 0;
  const context = vm.createContext({
    saveabilityChecker: () => ({}),
    document: {getElementById: () => ({dataset: {}})},
    frameDocument: () => {throw new Error('Unexpected full-page scan');},
    saveabilityStats: {ready: false, blocked: 0, runtime: 0},
    routePendingEdits: () => routed++,
  });
  vm.runInContext(bodyOf('updateSaveability') + '\nupdateSaveability();', context);
  assert.equal(routed, 1);
  assert.equal(context.saveabilityStats.ready, true);
});

test('hidden or empty PRD annotations do not poll page geometry', () => {
  const start = prdSource.indexOf(' function update(){');
  const update = prdSource.slice(start, prdSource.indexOf('\n function ', start + 1));
  for (const [visible, sourcePoints] of [[false, [{id: 'point'}]], [true, []]]) {
    let panelVisible;
    const context = vm.createContext({
      destroyed: false, cancelRegion: null, visible, sourcePoints, panelOpen: true,
      markers: {}, panel: {}, toggle: {setAttribute() {}}, lastPanelVisible: false,
      onPanelVisibility: value => {panelVisible = value;},
      computeView: () => {throw new Error('Unexpected geometry scan');},
      context: {key: ''}, doc: {},
    });
    vm.runInContext(update + '\nupdate();', context);
    assert.equal(context.markers.hidden, !visible);
    assert.equal(context.panel.hidden, !visible);
    if (visible) assert.equal(panelVisible, true);
  }
});

test('preview without patches does not capture DOM identities on every table refresh', () => {
  let captures = 0, applications = 0;
  const context = vm.createContext({
    mode: 'preview', state: {patches: {}},
    structuredClone, frameAppliedPatches: {},
    patchEngine: {capture: () => captures++, apply: () => applications++},
    routePendingEdits() {}, readSourcePatches: () => ({}), mergeSourcePatches,
    frameDocument: () => ({}), patchObserver: {takeRecords() {}},
    requestAnimationFrame() {}, updateResizeHandle() {}, scheduleLayers() {},
    showChanges: false,
  });
  vm.runInContext(bodyOf('applyAllPatches') + '\napplyAllPatches();', context);
  assert.equal(captures, 0);
  assert.equal(applications, 0);
  context.state.patches = {title: {selector: '#title', text: '草稿'}};
  vm.runInContext('applyAllPatches();', context);
  assert.equal(applications, 1, 'preview still restores drafts after dynamic rerender');
  context.state.patches = {};
  context.readSourcePatches = () => ({title: {selector: '#title', text: '已保存'}});
  vm.runInContext('applyAllPatches();', context);
  assert.equal(applications, 2, 'saved runtime patches still apply');
  context.readSourcePatches = () => ({});
  context.mode = 'edit';
  vm.runInContext('applyAllPatches();', context);
  assert.equal(captures, 1, 'editing captures new elements for stable move/delete identities');
});
