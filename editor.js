import {createAIAttachments} from './ai-attachments.mjs';
import {createAIChat} from './ai-chat.mjs';
import {verifyAIPage,compareAIErrors,loadAIFrame} from './ai-editor.mjs';
import {splitEditRoutes} from './ai-routing.mjs';
import { segmentIntersectsRect } from './sweep-selection.mjs';
import { selectionLayoutOffsets } from './selection-layout.mjs';
import {installVersionComparison} from './version-comparison.mjs';
import { pickElementAtPoint, pickElementsAtPoint } from './element-picking.mjs';
import { alignmentSnap, alignmentMatches, unionRects } from './alignment-guides.mjs';
import { CARD_SELECTOR, STYLE_PROPERTIES, ICON_CHOICES, IMAGE_CHOICES, elementLabel, contentFields, textTargetsForElement } from './editor-components.mjs';
import {
  createEditorState,
  batchElementChanges,
  deleteElement,
  upsertElementPatch,
  undoState,
  redoState,
  serializeEditorState,
} from './editor-core.mjs';
import { loadProjectEdits, mergeProjectAndDraft, saveProjectEdits } from './project-persistence.mjs';
import { createVisualPatchEngine } from './visual-patch-engine.mjs';
import { createStandaloneHtml } from './export-html.mjs';
import { interactiveHistorySource } from './history-preview.mjs';
import {compileSource} from './source-compiler.mjs';
import {readSourcePatches, mergeSourcePatches} from './source-runtime.mjs';
import {createSaveabilityChecker} from './saveability.mjs';
import { tableRowContext, blankTableRow, tableColumnContext, blankTableCell, columnInsertTarget, columnDeleteTarget } from './table-row-actions.mjs';
import { isTextToolbarTarget, textToolbarStyles } from './text-toolbar.mjs';

const editorQuery = new URLSearchParams(location.search);
const projectId = editorQuery.get('project') || 'builtin';
const projectEntry = editorQuery.get('entry') || (projectId === 'builtin' ? 'prototype.html' : '');
let projectConfig = null;
const projectParams = new URLSearchParams({project:projectId,entry:projectEntry});
const projectEndpoint = path => projectId === 'builtin' ? path : `${path}?${projectParams}`;
const STORAGE_KEY = projectId === 'builtin' ? 'jx-visual-editor-experiment-v2' : `html-editor-draft:${projectId}:${projectEntry}`;
const DRAFT_DIRTY_KEY = `${STORAGE_KEY}-dirty`;
const SOURCE_BASE_KEY = `${STORAGE_KEY}-source-base`;
let sourceBaseline=null;
let loadedSourceDocument=null;
let loadedSourceRevision=null;
let refreshingSource=false;
let saveabilityStats={ready:false,blocked:0,runtime:0};
const HELP_OPEN_KEY = 'html-editor-help-open';
const frame = document.getElementById('prototype-frame');
const canvasFrame = document.getElementById('canvas-frame');
const editorMain = document.querySelector('.editor-main');
const helpToggle = document.getElementById('editor-help-toggle');
const helpContent = document.getElementById('editor-help-content');
const toastElement = document.getElementById('toast');
const selectionPath = document.getElementById('selection-path');
const inspectorFields = document.getElementById('inspector-fields');
const selectedName = document.getElementById('selected-name');
const saveStatus = document.getElementById('save-status');
const canvasArea = document.querySelector('.canvas-area');
const annotationRail = document.getElementById('annotation-rail');
const annotationList = document.getElementById('annotation-list');
const annotationConnectors = document.getElementById('annotation-connectors');
const annotationCount = document.getElementById('annotation-count');
const undoButton = document.getElementById('undo-button');
const redoButton = document.getElementById('redo-button');
const changesToggle = document.getElementById('editor-changes-toggle');
const boxToggle = document.getElementById('editor-box-toggle');
const fields = {
  text: document.getElementById('prop-text'),
  fontSize: document.getElementById('prop-font-size'),
  fontWeight: document.getElementById('prop-font-weight'),
  color: document.getElementById('prop-color'),
  colorText: document.getElementById('prop-color-text'),
  textAlign: document.getElementById('prop-text-align'),
  background: document.getElementById('prop-background'),
  backgroundText: document.getElementById('prop-background-text'),
  radius: document.getElementById('prop-radius'),
  opacity: document.getElementById('prop-opacity'),
  width: document.getElementById('prop-width'),
  height: document.getElementById('prop-height'),
};

let state = loadState();
let mode = 'preview';
let selectedElement = null;
let draggedElement = null;
let patchEngine;
let patchObserver;
let projectReady = false;
let toastTimer = 0;
let mutationTimer = 0;
let showChanges = false;
let annotations = { version:1, boxes:[], notes:{}, colors:{} };
let annotationSaveQueue = Promise.resolve();
let changeRefreshTimer = 0;
let trackedFrameWindow = null;
let selectionLayer = null;
let selectionKeyHandler = null;
let selectedManualBoxId = null;
let annotationLayout = [];

function setHelpOpen(open, { persist = true } = {}) {
  editorMain.classList.toggle('help-open', open);
  helpContent.hidden = !open;
  helpToggle.setAttribute('aria-expanded', String(open));
  helpToggle.title = open ? '收起使用说明' : '展开使用说明';
  if (persist) localStorage.setItem(HELP_OPEN_KEY, open ? '1' : '0');
}

setHelpOpen(localStorage.getItem(HELP_OPEN_KEY) === '1', { persist:false });

const viewportSizes = {desktop:[1440,900,'桌面'],tablet:[900,1000,'平板'],mobile:[430,900,'手机']};
let viewportName = 'desktop';
const canvasScroll = document.getElementById('canvas-scroll');
const canvasStage = document.getElementById('canvas-stage');
const zoomSelect = document.getElementById('canvas-zoom');
let resizeFrame = 0;
function resizeCanvas() {
  const [width,height,label] = viewportSizes[viewportName];
  const availableWidth=Math.max(1,canvasScroll.clientWidth-26);
  const availableHeight=Math.max(1,canvasScroll.clientHeight-26);
  const widthScale=availableWidth/width;
  const heightScale=availableHeight/height;
  const scale=zoomSelect.value==='width' ? widthScale
    : zoomSelect.value==='fit' ? Math.min(widthScale,heightScale)
    : Number(zoomSelect.value);
  // Use the available height as the page viewport; the page owns vertical scrolling.
  const viewportHeight=Math.max(1,Math.floor(Math.min(height,availableHeight/scale)));
  canvasFrame.style.width = `${width}px`;
  canvasFrame.style.height = `${viewportHeight}px`;
  canvasFrame.style.transform = `scale(${scale})`;
  canvasStage.style.width = `${width*scale}px`;
  canvasStage.style.height = `${viewportHeight*scale}px`;
  document.getElementById('canvas-dimensions').textContent = `${label} · ${width} × ${viewportHeight}`;
  document.getElementById('zoom-readout').textContent = `${Math.round(scale*100)}%`;
  requestAnimationFrame(updateResizeHandle);
  if (showChanges) requestAnimationFrame(renderChangeMarkers);
}
zoomSelect.addEventListener('change',resizeCanvas);
new ResizeObserver(() => {cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(resizeCanvas);}).observe(canvasScroll);
resizeCanvas();

let selectedElements = new Set();
let cardInputs = [];
let copiedFormat = null;

function selectedList() { return [...selectedElements].filter(element=>element.isConnected && !isLocked(element)); }
function saveabilityChecker(patches=state.patches) {
  return loadedSourceDocument && createSaveabilityChecker(loadedSourceDocument, patches, frameDocument(), state.patches);
}
function allowEntries(entries) {
  const patches={...state.patches};
  for(const [key,patch] of entries)patches[key]={...patches[key],...patch};
  const checker=saveabilityChecker(patches);
  if(!checker){showToast('尚未读取页面源码，请刷新代码后再编辑');return false;}
  for(const [,patch] of entries) {
    const fields={},element=frameDocument().querySelector(patch.selector);
    for(const [field,value] of Object.entries(patch))if(!['selector','ai','templateText'].includes(field)) {
      const reason=checker.check({selector:patch.selector,[field]:value});if(reason)fields[field]=reason;
    }
    if('text' in patch){const binding=checker.templateBinding(patch.selector);if(binding)patch.templateText=binding;}
    if(Object.keys(fields).length)patch.ai={fields,context:{label:element?elementLabel(element):patch.selector,html:element?.outerHTML.slice(0,15000)||'',path:patch.selector}};
  }
  return true;
}
function allowChange(element,change={styles:{}}) {
  const selector=selectorFor(element);
  return allowEntries([[elementKey(selector),{selector,...change}]]);
}
function allowReorder(parent) {
  return allowEntries([...parent.children].filter(node=>!node.matches('script,style,template')).map((node,index)=>{
    const selector=selectorFor(node);return [elementKey(selector),{selector,position:{parent:selectorFor(parent),index}}];
  }));
}
function updateSaveability() {
  const checker=saveabilityChecker();
  const summary=document.getElementById('saveability-summary');
  if(!checker){summary.dataset.kind='blocked';summary.textContent='尚未读取源码，暂时无法编辑。请刷新代码。';return;}
  let runtime=0,blocked=0;
  for(const element of frameDocument().body.querySelectorAll('*')) {
    if(element.closest('script,style,template,svg *,#editor-change-overlay') || element.id.startsWith('ve-editor-'))continue;
    const status=checker.target(selectorFor(element));
    if(status.kind==='runtime')runtime++;
    if(status.kind==='blocked')blocked++;
  }
  saveabilityStats={ready:true,blocked,runtime};
  routePendingEdits();
}
function renderPendingHints(count) {
  document.getElementById('ai-button').textContent=count?'AI 待办 · '+count:'AI 待办';
  const summary=document.getElementById('saveability-summary');
  if(saveabilityStats.ready) {
    summary.dataset.kind=count?'blocked':'source';
    const description=saveabilityStats.blocked?`页面检查：${saveabilityStats.blocked} 个元素的修改可能需要 AI 辅助写入。`:saveabilityStats.runtime?`页面检查：${saveabilityStats.runtime} 个动态元素可通过页面调整记录保存。`:'页面检查：普通修改可直接写回源码。';
    summary.textContent=description+` 待 AI 写入：${count} 项（只统计你实际做过的修改）。`;
  }
  const detail=document.getElementById('ai-empty-detail');
  detail.textContent=(saveabilityStats.blocked?`页面检测到 ${saveabilityStats.blocked} 个可能需要 AI 辅助写入的元素。`:'')+'先进入编辑模式，选中并修改组件；需要 AI 写回的修改会自动显示在这里。';
}

function restoreSaveabilityControls() {
  document.querySelectorAll('[data-saveability-disabled]').forEach(control=>{control.disabled=false;delete control.dataset.saveabilityDisabled;});
}
function renderSaveability() {
  restoreSaveabilityControls();
  const checker=saveabilityChecker(),element=selectedList()[0];if(!element)return;
  const status=checker?.target(selectorFor(element)) || {kind:'blocked',reason:'尚未读取源码'};
  const section=document.getElementById('saveability-section');section.dataset.kind=status.kind;
  document.getElementById('saveability-title').textContent=status.kind==='blocked'?'修改将交给 AI 写入':status.kind==='template'?'文字直接写回生成模板':status.kind==='runtime'?'通过页面调整记录保存':'直接写回 HTML';
  document.getElementById('saveability-detail').textContent=status.reason+'。无法直接写入的修改会保留预览，保存时进入 AI 待办。';
}
function commitChanges(changes) {
  const entries = changes.map(({element,...change})=>{
    const selector=selectorFor(element);
    return [elementKey(selector),{selector,...change}];
  });
  if(!allowEntries(entries))return false;
  const next = batchElementChanges(state, entries);
  if(next===state)return;
  state=next; applyAllPatches(); persistState();return true;
}
function commitCardForm() {
  const changes=[];
  for(const field of cardInputs) {
    const value=field.input.value;
    if(field.input.disabled || value===field.original || !field.element.isConnected)continue;
    if(field.kind==='icon' || field.kind==='image') changes.push({element:field.element,[field.kind]:value});
    else if(field.leaf) changes.push({element:field.element,text:value});
    else changes.push({element:field.element,textNodes:{[field.index]:value}});
    field.original=value;
  }
  if(changes.length && commitChanges(changes))showToast('卡片内容已应用');
}
function renderCardForm(element) {
  const section=document.getElementById('card-section');
  const container=document.getElementById('card-fields');
  cardInputs=[];container.replaceChildren();
  section.hidden=selectedElements.size!==1 || !element.matches(CARD_SELECTOR);
  if(section.hidden)return;
  const addField=(label,input,field)=>{
    const row=document.createElement('label');const caption=document.createElement('span');caption.textContent=label;
    input.setAttribute('aria-label',label); row.append(caption,input);container.append(row);
    cardInputs.push({...field,input,original:input.value});
  };
  for(const field of contentFields(element)) {
    const input=document.createElement('input');input.type='text';input.value=field.value;
    addField(field.label,input,field);
  }
  const icon=frame.contentWindow.lucide ? element.querySelector('svg[data-lucide]') : null;
  const image=projectId === 'builtin' ? element.querySelector('img') : null;
  if(icon || image) {
    const target=icon || image,kind=icon?'icon':'image';
    const value=icon?icon.getAttribute('data-lucide'):(image.getAttribute('src') || '').split('/').pop();
    const select=document.createElement('select');
    const choices=icon?ICON_CHOICES:IMAGE_CHOICES.map(name=>[name,({'collection.png':'回款','customers.png':'客户','dashboard.png':'驾驶舱','declared.png':'申报','details.png':'明细','ordered.png':'下单','pending.png':'待办','profit.png':'利润','receivable.png':'应收','retained.png':'留存'})[name]]);
    if(!choices.some(([key])=>key===value)) select.add(new Option('当前图标',value));
    choices.forEach(([key,label])=>select.add(new Option(label,key)));
    select.value=value;addField('图标',select,{element:target,kind});
  }
}
document.getElementById('apply-card-content').addEventListener('click',commitCardForm);

function updateSelectionControls(element) {
  const count=selectedList().length;
  document.getElementById('selection-layout-section').hidden=count<2;
  for(const button of document.querySelectorAll('[data-selection-layout]'))
    button.disabled=count<(button.dataset.selectionLayout.startsWith('distribute-')?3:2);
  document.getElementById('selection-layout-hint').textContent=count<3
    ? '按所选元素的整体范围对齐。选择至少 3 个元素可等间距分布。'
    : '按所选元素的整体范围对齐；等间距保持两端元素位置，均分元素之间的空隙。';
  const chain=[];
  for(let node=element;node && node!==frameDocument().body;node=node.parentElement)chain.unshift(node);
  selectionPath.textContent=chain.map(elementLabel).join(' → ');
  document.getElementById('copy-format').disabled=selectedElements.size!==1;
  document.getElementById('paste-format').disabled=!copiedFormat;
  document.getElementById('move-up-button').disabled=selectedElements.size!==1;
  document.getElementById('move-down-button').disabled=selectedElements.size!==1;
}
function titleElement(element) {
  if(!element.matches(CARD_SELECTOR))return element;
  return contentFields(element).find(field=>field.label==='标题')?.element || element;
}
function styleSample(element,property) {
  return frame.contentWindow.getComputedStyle(['fontSize','fontWeight','color'].includes(property)?titleElement(element):element)[property];
}
function formatSnapshot(element) {
  const selected=element.classList.contains('ve-selected');
  const transition=element.style.transition;
  element.style.transition='none';
  if(selected)element.classList.remove('ve-selected');
  const style=frame.contentWindow.getComputedStyle(element);
  const snapshot=Object.fromEntries(STYLE_PROPERTIES.map(property=>[property,style[property]]));
  if(selected)element.classList.add('ve-selected');
  element.style.transition=transition;
  return snapshot;
}
document.getElementById('copy-format').addEventListener('click',()=>{
  if(selectedElements.size!==1)return;
  commitCardForm();
  copiedFormat={styles:formatSnapshot(selectedElement),name:elementLabel(selectedElement),fields:[]};
  if(selectedElement.matches(CARD_SELECTOR)) {
    const seen=new Set();
    for(const field of contentFields(selectedElement)) {
      if(seen.has(field.element))continue;
      seen.add(field.element);
      copiedFormat.fields.push({label:field.label,styles:formatSnapshot(field.element)});
    }
  }
  document.getElementById('format-hint').textContent=`已复制「${copiedFormat.name}」。选择目标后应用；不会复制文字、数值或宽高。`;
  document.getElementById('paste-format').disabled=false;showToast('格式已复制，请选择目标');
  updateTextToolbar();
});
document.getElementById('paste-format').addEventListener('click',()=>{
  if(!copiedFormat)return;
  commitCardForm();const changes=[];
  for(const element of selectedList()) {
    changes.push({element,styles:copiedFormat.styles});
    if(element.matches(CARD_SELECTOR)) for(const field of contentFields(element)) {
      const matching=copiedFormat.fields.find(source=>source.label===field.label);
      if(matching)changes.push({element:field.element,styles:matching.styles});
    }
  }
  if(!commitChanges(changes))return;
  fillInspector(selectedElement);showToast(`已向 ${selectedElements.size} 个元素应用格式`);
  updateTextToolbar();
});

let pointerMode = 'move';
let moveGesture = null;
let sweepGesture = null;
let suppressNextClick = false;
function translationFor(element) {
  const parts=(element.style.translate || '').split(/\s+/);
  return {x:parseFloat(parts[0])||0,y:parseFloat(parts[1])||0};
}
function updateMovementReadout() {
  const list=selectedList();
  if(!list.length)return;
  const first=translationFor(list[0]);
  document.getElementById('movement-offset').textContent=list.some(node=>{const p=translationFor(node);return p.x!==first.x||p.y!==first.y;})
    ? '偏移：不同值' : `水平 ${first.x}px · 垂直 ${first.y}px`;
}
function arrangeSelection(action) {
  if(mode!=='edit')return;
  cancelMovement();commitCardForm();
  const elements=selectedList();
  if(elements.length<(action.startsWith('distribute-')?3:2))return;
  const offsets=selectionLayoutOffsets(elements.map(element=>element.getBoundingClientRect()),action);
  const changes=elements.flatMap((element,index)=>{
    const {x,y}=offsets[index];if(Math.abs(x)<.001 && Math.abs(y)<.001)return [];
    const origin=translationFor(element);
    return [{element,styles:{translate:`${origin.x+x}px ${origin.y+y}px`}}];
  });
  if(!changes.length){showToast('所选元素已按此方式排列');return;}
  if(!commitChanges(changes))return;
  refreshSelection();updateResizeHandle();
  showToast('已调整所选元素位置，可一次撤销');
}
for(const button of document.querySelectorAll('[data-selection-layout]'))
  button.addEventListener('click',()=>arrangeSelection(button.dataset.selectionLayout));
function nudgeSelection(direction, step=1) {
  if(mode!=='edit'||!selectedElements.size)return;
  commitCardForm();
  const [dx,dy]={left:[-step,0],right:[step,0],up:[0,-step],down:[0,step]}[direction];
  const changes=selectedList().map(element=>{
    const origin=translationFor(element),next={x:origin.x+dx,y:origin.y+dy};
    return {element,styles:{translate:`${next.x}px ${next.y}px`}};
  });
  commitChanges(changes);updateMovementReadout();
}
function handleEditorKey(event) {
  if((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='s' && !event.altKey && !event.shiftKey) {
    event.preventDefault();event.stopImmediatePropagation();
    if(!projectReady || sourceBusy || document.querySelector('dialog[open]:not(#ai-dialog)'))return;
    event.target.blur?.();commitCardForm();void saveToSource();return;
  }
  if(document.getElementById('source-dialog')?.open || document.getElementById('comparison-dialog')?.open)return;
  if(document.getElementById('history-dialog')?.open)return;
  if(event.key==='Escape') {
    const activeGesture=!!(moveGesture || sweepGesture || resizeGesture);
    cancelMovement();
    finishResize(false);
    if(!activeGesture && mode==='edit' && selectedElements.size
      && !document.querySelector('dialog[open]:not(#ai-dialog)')
      && !event.target.closest?.('input,textarea,select,[contenteditable="true"],#editor-change-overlay,.container-picker-menu')) {
      commitCardForm();clearSelection();event.preventDefault();
    }
    return;
  }
  if(event.target.closest?.('input,textarea,select,[contenteditable="true"]') || event.target.closest?.('#editor-change-overlay,.container-picker-menu'))return;
  if((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && mode==='edit') {
    const key=event.key.toLowerCase();
    if(key==='c' && selectedElements.size===1 && structureAllowed(selectedElement)) {
      event.preventDefault();event.stopImmediatePropagation();copyComponent();return;
    }
    if(key==='v' && componentClipboard) {
      event.preventDefault();event.stopImmediatePropagation();pasteComponent();return;
    }
  }
  if((event.key==='Delete' || event.key==='Backspace') && !event.metaKey && !event.ctrlKey && !event.altKey && mode==='edit' && selectedElements.size) {
    event.preventDefault();event.stopImmediatePropagation();deleteSelection();return;
  }
  if((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='z') {
    event.preventDefault();event.stopImmediatePropagation();
    (event.shiftKey?redoButton:undoButton).click();return;
  }
  const directions={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};
  if(directions[event.key] && !event.metaKey && !event.ctrlKey && !event.altKey && mode==='edit' && selectedElements.size) {
    event.preventDefault();event.stopPropagation();nudgeSelection(directions[event.key],event.shiftKey?10:1);
  }
}
function setPointerMode(value) {
  cancelMovement();pointerMode=value;
  for(const name of ['move','swap']) {
    const button=document.getElementById(`pointer-${name}`);
    button.classList.toggle('active',value===name);button.setAttribute('aria-pressed',String(value===name));
  }
  frameDocument()?.body?.classList.toggle('ve-pointer-move',value==='move' || value==='swap');
  frameDocument()?.body?.classList.remove('ve-pointer-select');
}
function cancelMovement() {
  document.getElementById('editor-alignment-guides')?.remove();
  if(sweepGesture)finishSweepSelection(null,true);
  if(!moveGesture)return;
  for(const {element,original} of moveGesture.elements) element.style.translate=original;
  for(const entry of moveGesture.elements) {
    entry.ghost?.remove();
    if(entry.visibility!==undefined)entry.element.style.visibility=entry.visibility;
  }
  moveGesture.dropParent?.classList.remove('ve-drop-target');
  moveGesture.swapTarget?.classList.remove('ve-drop-target');
  try {moveGesture.capture.releasePointerCapture(moveGesture.pointerId);}catch{}
  moveGesture=null;updateMovementReadout();updateResizeHandle();
}
// Keep the canvas layout stable while sweeping: open/update the inspector only
// after release, so selecting the first component cannot shift the pointer path.
function sweepCandidates() {
  const doc=frameDocument();
  const nodes=[...doc.body.querySelectorAll('*')].filter(node=>{
    if(node.closest('script,style,template,[hidden],[data-ve-locked],[contenteditable="true"],#editor-change-overlay,#editor-box-selection') || node.closest('svg')!==null && !node.matches('svg'))return false;
    return node.matches(`${CARD_SELECTOR},button,a,input,textarea,select,svg,img,canvas,video`)
      || [...node.childNodes].some(child=>child.nodeType===3 && child.textContent.trim())
      || (node.matches('div') && !node.childElementCount);
  });
  const roots=nodes.filter(node=>!nodes.some(other=>other!==node && other.contains(node)));
  return roots.map(node=>({node,rect:node.getBoundingClientRect()})).filter(({node,rect})=>rect.width>0 && rect.height>0 && rect.bottom>0 && rect.top<doc.defaultView.innerHeight && doc.defaultView.getComputedStyle(node).visibility!=='hidden');
}
function sweepPath(from,to) {
  for(const {node,rect} of sweepGesture.candidates) {
    if(!node.isConnected || selectedElements.has(node) || !segmentIntersectsRect(from,to,rect))continue;
    if([...selectedElements].some(other=>node.contains(other)))continue;
    for(const other of selectedElements)if(other.contains(node)){other.classList.remove('ve-selected');selectedElements.delete(other);}
    selectedElements.add(node);selectedElement=node;node.classList.add('ve-selected');
  }
}
function activateSweepSelection() {
  if(!sweepGesture || sweepGesture.moved)return;
  sweepGesture.moved=true;sweepGesture.candidates=sweepCandidates();
  if(!sweepGesture.additive){selectedElements.forEach(node=>node.classList.remove('ve-selected'));selectedElements.clear();selectedElement=null;}
  clearHover();document.getElementById('text-toolbar').hidden=true;
  frameDocument().body.classList.add('ve-pointer-select');
  sweepPath(sweepGesture.start,sweepGesture.start);
}
function beginSweepSelection(event) {
  suppressNextClick=false;
  if(pointerMode!=='move' || mode!=='edit' || event.button!==0 || event.altKey || event.target.closest?.('input,textarea,select,[contenteditable="true"],#editor-change-overlay,#editor-box-selection'))return;
  commitCardForm();clearHover();
  sweepGesture={pointerId:event.pointerId,capture:frameDocument().body,start:{x:event.clientX,y:event.clientY},last:{x:event.clientX,y:event.clientY},before:[...selectedElements],primary:selectedElement,additive:event.shiftKey,moved:false,target:pickCanvasTarget(event),down:event};
  sweepGesture.timer=setTimeout(activateSweepSelection,280);
  sweepGesture.capture.setPointerCapture(event.pointerId);
  frame.contentWindow.focus();event.preventDefault();event.stopImmediatePropagation();
}
function updateSweepSelection(event) {
  if(!sweepGesture || event.pointerId!==sweepGesture.pointerId)return;
  const gesture=sweepGesture;
  if(!gesture.moved) {
    if(Math.hypot(event.clientX-gesture.start.x,event.clientY-gesture.start.y)<4)return;
    clearTimeout(gesture.timer);
    if(gesture.target && !gesture.additive) {
      // A quick drag moves the selection. Holding first starts selection instead.
      sweepGesture=null;
      try{gesture.capture.releasePointerCapture(gesture.pointerId);}catch{}
      beginPointerMovement(gesture.down);updatePointerMovement(event);
      return;
    }
    activateSweepSelection();
  }
  sweepPath(gesture.last,{x:event.clientX,y:event.clientY});
  gesture.last={x:event.clientX,y:event.clientY};
  event.preventDefault();event.stopImmediatePropagation();
}
function finishSweepSelection(event,cancel=false) {
  if(!sweepGesture || (event && event.pointerId!==sweepGesture.pointerId))return;
  if(event && !cancel && sweepGesture.moved)sweepPath(sweepGesture.last,{x:event.clientX,y:event.clientY});
  const gesture=sweepGesture;sweepGesture=null;clearTimeout(gesture.timer);
  frameDocument()?.body?.classList.remove('ve-pointer-select');
  try{gesture.capture.releasePointerCapture(gesture.pointerId);}catch{}
  suppressNextClick=true;if(!cancel)setTimeout(()=>{suppressNextClick=false;},0);
  if(cancel) {
    selectedElements.forEach(node=>node.classList.remove('ve-selected'));
    selectedElements=new Set(gesture.before.filter(node=>node.isConnected));selectedElement=gesture.primary;
  } else if(!gesture.moved && event) {
    const target=pickCanvasTarget(event);
    if(target)selectElement(target,{additive:event.shiftKey});
    else {commitCardForm();clearSelection();}
  }
  if(selectedElements.size)refreshSelection();else clearSelection();
  if(event){event.preventDefault();event.stopImmediatePropagation();}
}
function beginPointerMovement(event) {
  if(!['move','swap'].includes(pointerMode) || mode!=='edit' || event.button!==0 || event.shiftKey || event.altKey || event.target.closest?.('input,textarea,[contenteditable="true"],#editor-change-overlay,#editor-box-selection'))return;
  const target=pickCanvasTarget(event);
  if(!target || !target.parentElement || target===frameDocument().body || isLocked(target))return;
  document.activeElement?.blur();
  frameDocument().activeElement?.blur();
  frame.contentWindow.focus();
  if(!selectedElements.has(target))selectElement(target);
  commitCardForm();
  if(pointerMode==='swap' && selectedElements.size!==1){showToast('换位时请只选择一个元素');return;}
  clearTimeout(mutationTimer);
  const roots=selectedList().filter(node=>!selectedList().some(other=>other!==node && other.contains(node)));
  if(roots.some(node=>!allowChange(node)))return;
  if(pointerMode==='swap' && !allowReorder(target.parentElement))return;
  moveGesture={x:event.clientX,y:event.clientY,pointerId:event.pointerId,capture:target,elements:roots.map(element=>({element,origin:translationFor(element),original:element.style.translate})),moved:false,swapTarget:null};
  moveGesture.references=alignmentReferences();
  target.setPointerCapture(event.pointerId);
  event.preventDefault();event.stopImmediatePropagation();
}
function updatePointerMovement(event) {
  if(!moveGesture || event.pointerId!==moveGesture.pointerId)return;
  const dx=event.clientX-moveGesture.x,dy=event.clientY-moveGesture.y;
  if(!moveGesture.moved && Math.hypot(dx,dy)<4)return;
  moveGesture.moved=true;
  const first=moveGesture.elements[0].element;
  for(const entry of moveGesture.elements) {
    const next={x:entry.origin.x+dx,y:entry.origin.y+dy};
    entry.element.style.translate=`${next.x}px ${next.y}px`;
  }
  if(pointerMode==='move')applyAlignmentGuides(event.altKey);
  if(pointerMode==='move') {
    moveGesture.dropParent?.classList.remove('ve-drop-target');
    moveGesture.dropParent=dragContainerAt(event);
    moveGesture.dropParent?.classList.add('ve-drop-target');
    for(const entry of moveGesture.elements) {
      if(!entry.ghost) {
        const copy=entry.element.cloneNode(true);
        const originals=[entry.element,...entry.element.querySelectorAll('*')];
        [copy,...copy.querySelectorAll('*')].forEach((node,index)=>{
          const style=frame.contentWindow.getComputedStyle(originals[index]);
          for(const property of style)node.style.setProperty(property,style.getPropertyValue(property));
          node.removeAttribute('id');node.removeAttribute('data-ve-node');
          node.style.pointerEvents='none';
        });
        copy.querySelectorAll('script,iframe,object,embed').forEach(node=>node.remove());
        copy.id='ve-editor-drag-preview';
        entry.visibility=entry.element.style.visibility;
        entry.element.style.visibility='hidden';
        frameDocument().documentElement.append(copy);entry.ghost=copy;
      }
      const rect=entry.element.getBoundingClientRect();
      Object.assign(entry.ghost.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,boxSizing:'border-box',margin:'0',translate:'none',transform:'none',visibility:'visible',zIndex:'2147483647'});
    }
  }
  updateResizeHandle();
  if(pointerMode==='swap') {
    const candidate=[...first.parentElement.children].find(node=>{
      if(node===first || node.matches('template,script,style'))return false;
      const r=node.getBoundingClientRect();return r.width>0 && r.height>0 && event.clientX>=r.left && event.clientX<=r.right && event.clientY>=r.top && event.clientY<=r.bottom;
    });
    moveGesture.swapTarget?.classList.remove('ve-drop-target');
    moveGesture.swapTarget=candidate;candidate?.classList.add('ve-drop-target');
  }
  updateMovementReadout();event.preventDefault();event.stopImmediatePropagation();
}
function dragContainerAt(event) {
  const doc=frameDocument(),moving=moveGesture.elements.map(entry=>entry.element);
  if(event.metaKey || event.ctrlKey)return doc.body;
  for(const hit of doc.elementsFromPoint(event.clientX,event.clientY)) {
    if(hit.closest('#ve-editor-drag-preview,#editor-change-overlay') || moving.some(node=>node.contains(hit)))continue;
    let node=hit;
    while(node && node!==doc.body) {
      if(isLocked(node))break;
      if(isContainer(node) && !moving.some(item=>item.contains(node)))return node;
      node=node.parentElement;
    }
  }
  return doc.body;
}
function freelyPlaceElements(entries,parent) {
  const changes=[],orders=new Map();
  for(const {element} of entries)orders.set(element.parentElement,layerChildren(element.parentElement));
  if(!orders.has(parent))orders.set(parent,layerChildren(parent));
  for(const {element,rect} of entries) {
    if(!structureAllowed(element) || element.contains(parent))continue;
    const oldParent=element.parentElement,next=element.nextSibling,oldStyle=element.getAttribute('style');
    const computed=frame.contentWindow.getComputedStyle(element);
    // Read presentation styles without the editor's selection halo.
    const styles={...formatSnapshot(element),...Object.fromEntries(['fontFamily','lineHeight','objectFit','objectPosition','display'].map(key=>[key,computed[key]]))};
    Object.assign(styles,{position:'absolute',width:`${rect.width}px`,height:`${rect.height}px`,boxSizing:'border-box',margin:'0',translate:'0px 0px',transform:'none',right:'auto',bottom:'auto',left:'0px',top:'0px',zIndex:'1'});
    Object.assign(element.style,styles);parent.append(element);
    const origin=element.getBoundingClientRect();
    styles.left=`${rect.left-origin.left}px`;styles.top=`${rect.top-origin.top}px`;
    oldParent.insertBefore(element,next);
    if(oldStyle===null)element.removeAttribute('style');else element.setAttribute('style',oldStyle);
    orders.set(oldParent,orders.get(oldParent).filter(node=>node!==element));
    orders.set(parent,orders.get(parent).filter(node=>node!==element).concat(element));
    changes.push({element,styles});
  }
  for(const [container,order] of orders)order.forEach((element,index)=>changes.push({element,position:{parent:selectorFor(container),index}}));
  commitChanges(changes);expandedLayers.add(selectorFor(parent));fillInspector(selectedElement);
}
function alignmentReferences() {
  const selected=selectedList(),doc=frameDocument();
  const bounds=unionRects(selected.map(node=>node.getBoundingClientRect()));
  return [...doc.body.querySelectorAll('div,section,article,h1,h2,h3,h4,h5,h6,p,span,strong,b,small,em,label,button,img,svg,input,td,th')]
    .filter(node=>!node.closest('svg *,#editor-change-overlay,#editor-box-selection') && !selected.some(item=>item.contains(node)||node.contains(item)))
    .map(node=>({node,rect:node.getBoundingClientRect()}))
    .filter(({node,rect})=>rect.width>0 && rect.height>0 && rect.bottom>0 && rect.right>0 && rect.top<doc.defaultView.innerHeight && rect.left<doc.defaultView.innerWidth && doc.defaultView.getComputedStyle(node).visibility!=='hidden')
    .map(item=>({...item,distance:Math.hypot((item.rect.left+item.rect.right-bounds.left-bounds.right)/2,(item.rect.top+item.rect.bottom-bounds.top-bounds.bottom)/2)}))
    .sort((a,b)=>a.distance-b.distance).slice(0,180).map(item=>item.node);
}
function applyAlignmentGuides(bypass) {
  document.getElementById('editor-alignment-guides')?.remove();
  if(bypass || !moveGesture)return;
  const elements=moveGesture.elements.map(entry=>entry.element);
  const rect=unionRects(elements.map(node=>node.getBoundingClientRect()));
  const scale=frame.getBoundingClientRect().width/frame.clientWidth;
  const references=moveGesture.references.filter(node=>node.isConnected).map(node=>node.getBoundingClientRect());
  const snap=alignmentSnap(rect,references,6/scale);
  if(!snap.x && !snap.y)return;
  // All selected elements receive the same alignment correction.
  const corrections=elements.map(element=>{
    const current=translationFor(element),next={x:current.x+(snap.x?.delta||0),y:current.y+(snap.y?.delta||0)};
    return {element,current,next};
  });
  const canX=corrections.every(({current,next})=>Math.abs(next.x-current.x-(snap.x?.delta||0))<.6);
  const canY=corrections.every(({current,next})=>Math.abs(next.y-current.y-(snap.y?.delta||0))<.6);
  for(const {element,current,next} of corrections)element.style.translate=`${canX?next.x:current.x}px ${canY?next.y:current.y}px`;
  const actual=unionRects(elements.map(node=>node.getBoundingClientRect()));
  const overlay=document.createElement('div');overlay.id='editor-alignment-guides';overlay.setAttribute('aria-hidden','true');
  Object.assign(overlay.style,{position:'fixed',inset:'0',pointerEvents:'none',zIndex:'9'});
  const f=frame.getBoundingClientRect(),c=canvasScroll.getBoundingClientRect();
  const clip={left:Math.max(f.left,c.left),right:Math.min(f.right,c.right),top:Math.max(f.top,c.top),bottom:Math.min(f.bottom,c.bottom)};
  // Extend guides to the visible canvas. Use screen-pixel tolerances at
  // every zoom level.
  for(const {axis,value,index} of alignmentMatches(actual,references,.6/scale)) {
    if(!(axis==='x'?canX:canY))continue;
    const coordinate=(axis==='x'?f.left:f.top)+value*scale;
    if(coordinate<(axis==='x'?clip.left:clip.top) || coordinate>(axis==='x'?clip.right:clip.bottom))continue;
    const line=document.createElement('div');line.dataset.axis=axis;line.dataset.anchor=String(index);
    line.className='alignment-guide';
    Object.assign(line.style,{left:`${axis==='x'?coordinate:clip.left}px`,top:`${axis==='y'?coordinate:clip.top}px`,width:axis==='x'?'1px':`${clip.right-clip.left}px`,height:axis==='y'?'1px':`${clip.bottom-clip.top}px`});
    overlay.append(line);

  }
  if(overlay.childElementCount)document.body.append(overlay);
}
function endPointerMovement(event) {
  if(!moveGesture || event.pointerId!==moveGesture.pointerId)return;
  const gesture=moveGesture, positions=gesture.elements.map(({element})=>({element,styles:{translate:element.style.translate}}));
  const placed=gesture.elements.map(({element})=>({element,rect:element.getBoundingClientRect()}));
  cancelMovement();
  suppressNextClick=true;setTimeout(()=>{suppressNextClick=false;},0);
  if(gesture.moved) {
    if(pointerMode==='move') {
      if(gesture.dropParent && placed.every(({element})=>structureAllowed(element)) && placed.some(({element})=>element.parentElement!==gesture.dropParent)) {
        freelyPlaceElements(placed,gesture.dropParent);
        showToast(gesture.dropParent===frameDocument().body?'已放在页面上，可自由拖动':'已移入高亮容器，保持松手位置');
      } else commitChanges(positions);
    }
    else if(gesture.swapTarget?.isConnected) {
      const a=gesture.elements[0].element,b=gesture.swapTarget,parent=a.parentElement;
      if(b.parentElement===parent) {
        const order=[...parent.children].filter(node=>node.tagName!=='TEMPLATE');
        const aIndex=order.indexOf(a),bIndex=order.indexOf(b);
        order[aIndex]=b;order[bIndex]=a;
        const parentSelector=selectorFor(parent);
        const changes=order.map((element,index)=>({element,position:{parent:parentSelector,index}}));
        changes.push({element:a,styles:{translate:'0px 0px'}},{element:b,styles:{translate:'0px 0px'}});
        if(commitChanges(changes))showToast('同级元素已交换，可一次撤销');
      }
    } else showToast('未命中同级元素，已保留原位置');
  }
  patchObserver?.takeRecords();updateMovementReadout();
  event.preventDefault();event.stopImmediatePropagation();
}
for(const name of ['move','swap'])document.getElementById(`pointer-${name}`).addEventListener('click',()=>setPointerMode(name));
document.getElementById('place-on-page').addEventListener('click',()=>{
  const selected=selectedList(),roots=selected.filter(node=>!selected.some(other=>other!==node && other.contains(node)));
  if(!roots.length || roots.some(node=>!structureAllowed(node)))return;
  commitCardForm();
  freelyPlaceElements(roots.map(element=>({element,rect:element.getBoundingClientRect()})),frameDocument().body);
  showToast('已放在页面上，保持当前位置');
});
document.querySelectorAll('[data-nudge]').forEach(button=>button.addEventListener('click',event=>nudgeSelection(button.dataset.nudge,event.shiftKey?10:1)));
document.getElementById('reset-offset').addEventListener('click',()=>{commitChanges(selectedList().map(element=>({element,styles:{translate:'0px 0px'}})));updateMovementReadout();});
document.addEventListener('keydown',handleEditorKey);

function loadState() {
  try {
    return createEditorState(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return createEditorState();
  }
}

function persistState(message = '浏览器草稿已自动保存', { dirty = true } = {}) {
  localStorage.setItem(STORAGE_KEY, serializeEditorState(state));
  localStorage.setItem(DRAFT_DIRTY_KEY, dirty ? '1' : '0');
  saveStatus.textContent = message;
  updateHistoryButtons();
}

async function initializeProjectState() {
  try {
    const project = projectId === 'builtin' ? await loadProjectEdits(fetch) : await loadProjectEdits(fetch, projectEndpoint('/api/visual-edits'));
    const browserDraft = state;
    const dirtyMarker = localStorage.getItem(DRAFT_DIRTY_KEY);
    const draftIsDirty = dirtyMarker === '1' || (dirtyMarker === null && Object.keys(browserDraft.patches || {}).length > 0);
    state = createEditorState(mergeProjectAndDraft(project, browserDraft, draftIsDirty));
    persistState(draftIsDirty && Object.keys(browserDraft.patches || {}).length
      ? '已恢复未保存的浏览器草稿'
      : Object.keys(state.patches).length?'存在未写入源码的项目调整，请保存或完成 AI 待办后交付':'已加载项目源码', { dirty: draftIsDirty });
  } catch (error) {
    saveStatus.textContent = `项目服务未连接，仅保留浏览器草稿：${error.message}`;
  }
}

function updateHistoryButtons() {
  undoButton.disabled = !state.past.length;
  redoButton.disabled = !state.future.length;
}

function showToast(message) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.add('show');
  toastTimer = setTimeout(() => toastElement.classList.remove('show'), 1800);
}

function frameDocument() {
  return frame.contentDocument;
}

function selectorFor(element) {
  return element ? patchEngine.selectorFor(element) : '';
}

function elementKey(selector) {
  let hash = 2166136261;
  for (let index = 0; index < selector.length; index += 1) {
    hash ^= selector.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ve-${(hash >>> 0).toString(36)}`;
}

function editableTarget(target) {
  if (!(target instanceof frame.contentWindow.Element)) return null;
  if (target.closest('#editor-change-overlay')) return null;
  const selector = [
    '[data-ve-node]', '[data-ve-editable]', '.panel', '.ha-metric', '.ha-overtime-card', '.ha-section', '.ha-topic', '.ha-care',
    '.ha-business-role', '.finance-kpi', '.finance-stat', '.finance-block', '.procurement-metric',
    '.live-card', '.heading', '.panel-title', 'h1', 'h2', 'h3', 'p', 'strong', 'b', 'span',
    'small', 'button', 'td', 'th', 'label', 'svg[data-lucide]', 'img', 'em'
  ].join(',');
  return target.closest(selector) || (!target.matches('html,body,script,style,link,meta') ? target : null);
}

function isReorderable(element) {
  return element?.matches([
    '[data-ve-node]', '.panel', '.ha-metric', '.ha-overtime-card', '.ha-section', '.ha-topic', '.ha-care', '.ha-business-role',
    '.finance-kpi', '.finance-stat', '.finance-block', '.procurement-metric', '.live-card'
  ].join(','));
}

async function loadAnnotations() {
  try {
    const response = await fetch(projectEndpoint('/api/change-annotations'), { cache:'no-store' });
    if (!response.ok) throw new Error('无法读取改动标记');
    annotations = await response.json();
    annotations.boxes ||= [];
    annotations.notes ||= {};
    annotations.colors ||= {};
  } catch (error) {
    showToast(`${error.message}，请确认本地开发服务已启动`);
  }
}

function saveAnnotations() {
  const snapshot = JSON.parse(JSON.stringify(annotations));
  annotationSaveQueue = annotationSaveQueue.catch(() => {}).then(async () => {
    const response = await fetch(projectEndpoint('/api/change-annotations'), {
      method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(snapshot)
    });
    if (!response.ok) throw new Error('改动说明保存失败');
    showToast('改动说明已保存到项目');
  }).catch(error => showToast(error.message));
  return annotationSaveQueue;
}

function queryPatchElement(doc, selector) {
  try { return doc?.querySelector(selector) || null; } catch { return null; }
}

function visibleElement(element) {
  if (!element || element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function activeChangeScope(doc) {
  return [...doc.querySelectorAll('.drawer.open, dialog[open], [role="dialog"][aria-modal="true"], .modal.open, .modal.show')]
    .filter(visibleElement)
    .reduce((top, element) => !top ||
      (parseInt(doc.defaultView.getComputedStyle(element).zIndex) || 0) >=
      (parseInt(doc.defaultView.getComputedStyle(top).zIndex) || 0) ? element : top, null);
}

function markerCockpit(doc) {
  return doc.querySelector('.cockpit-view.active')?.id.replace(/^cockpit-/, '') || location.hash.slice(1) || (projectId === 'builtin' ? 'human-admin' : 'page');
}

function markerContext(scope) {
  return scope ? (scope.querySelector('h2, h1, [role="heading"]')?.textContent.trim() || scope.id || 'dialog') : '';
}

function annotationNoteKey(box) { return `box:${box.id}`; }

function markerTheme(noteKey) {
  return annotations.colors?.[noteKey] === 'red'
    ? {name:'red', solid:'#e5484d', shadow:'rgba(229,72,77,.14)', button:'#c9343a'}
    : {name:'blue', solid:'#2f80ed', shadow:'rgba(47,128,237,.12)', button:'#246dcc'};
}

function addDismissButton(marker, remove, theme) {
  const button = marker.ownerDocument.createElement('button');
  button.type = 'button';
  button.textContent = '×';
  button.title = '移除此改动标识（不修改页面内容）';
  button.setAttribute('aria-label', '移除此改动标识');
  Object.assign(button.style, {position:'absolute',zIndex:'3',right:'-9px',top:'-9px',width:'20px',height:'20px',borderRadius:'50%',border:`1px solid ${theme.solid}`,background:'#fff',color:theme.button,cursor:'pointer',pointerEvents:'auto',padding:'0',lineHeight:'16px'});
  button.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    remove();
    saveAnnotations();
    renderChangeMarkers();
  });
  marker.appendChild(button);
}

function addResizeHandles(marker, box, target, rect, theme) {
  const directions = {
    nw:['0','0','nwse-resize'], n:['50%','0','ns-resize'], ne:['100%','0','nesw-resize'],
    e:['100%','50%','ew-resize'], se:['100%','100%','nwse-resize'], s:['50%','100%','ns-resize'],
    sw:['0','100%','nesw-resize'], w:['0','50%','ew-resize'],
  };
  Object.entries(directions).forEach(([direction, [left, top, cursor]]) => {
    const handle = marker.ownerDocument.createElement('span');
    handle.title = '调整手动标记范围';
    Object.assign(handle.style, {position:'absolute',zIndex:'1',left,top,width:'10px',height:'10px',border:`2px solid ${theme.solid}`,borderRadius:'50%',background:'#fff',transform:'translate(-50%,-50%)',cursor,pointerEvents:'auto'});
    handle.addEventListener('pointerdown', event => {
      event.preventDefault(); event.stopPropagation();
      const startX = event.clientX, startY = event.clientY;
      const initial = {x:box.x,y:box.y,width:box.width,height:box.height};
      const bounds = target.getBoundingClientRect();
      const anchorWidth = Math.max(target.scrollWidth, bounds.width), anchorHeight = Math.max(target.scrollHeight, bounds.height);
      const minWidth = 12 / anchorWidth, minHeight = 12 / anchorHeight;
      handle.setPointerCapture(event.pointerId);
      const move = moveEvent => {
        const dx = (moveEvent.clientX - startX) / anchorWidth;
        const dy = (moveEvent.clientY - startY) / anchorHeight;
        let x=initial.x,y=initial.y,width=initial.width,height=initial.height;
        if (direction.includes('e')) width=Math.max(minWidth,Math.min(1-x,initial.width+dx));
        if (direction.includes('s')) height=Math.max(minHeight,Math.min(1-y,initial.height+dy));
        if (direction.includes('w')) { x=Math.max(0,Math.min(initial.x+initial.width-minWidth,initial.x+dx)); width=initial.width+initial.x-x; }
        if (direction.includes('n')) { y=Math.max(0,Math.min(initial.y+initial.height-minHeight,initial.y+dy)); height=initial.height+initial.y-y; }
        Object.assign(box,{x,y,width,height});
        marker.style.left=`${rect.left+(x-initial.x)*anchorWidth}px`;
        marker.style.top=`${rect.top+(y-initial.y)*anchorHeight}px`;
        marker.style.width=`${Math.max(12,rect.right-rect.left+(width-initial.width)*anchorWidth)}px`;
        marker.style.height=`${Math.max(12,rect.bottom-rect.top+(height-initial.height)*anchorHeight)}px`;
      };
      const finish = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('pointercancel', finish);
        saveAnnotations(); renderChangeMarkers();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
    });
    marker.appendChild(handle);
  });
}

function boxScrollContainer(target, rawRect) {
  const win = target.ownerDocument.defaultView;
  const centerX = (rawRect.left + rawRect.right) / 2;
  const centerY = (rawRect.top + rawRect.bottom) / 2;
  return [...target.querySelectorAll('*')].filter(element => {
    const style = win.getComputedStyle(element);
    const scrollsX = /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
    const scrollsY = /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    if (!scrollsX && !scrollsY) return false;
    const bounds = element.getBoundingClientRect();
    return centerX >= bounds.left && centerX <= bounds.right && centerY >= bounds.top && centerY <= bounds.bottom;
  }).sort((first, second) => {
    const a = first.getBoundingClientRect(), b = second.getBoundingClientRect();
    return a.width * a.height - b.width * b.height;
  })[0] || null;
}

function visibleChangeRect(target, scope, customRect, scrollContainer) {
  if (!visibleElement(target) || (scope && !scope.contains(target))) return null;
  if (!scope && target.closest('.drawer, dialog, [role="dialog"], .modal')) return null;
  const rect = customRect || target.getBoundingClientRect();
  const win = target.ownerDocument.defaultView;
  let left = Math.max(2, rect.left - 2), top = Math.max(2, rect.top - 2);
  let right = Math.min(win.innerWidth - 2, rect.right + 2), bottom = Math.min(win.innerHeight - 2, rect.bottom + 2);
  let clipTop = 2, clipRight = win.innerWidth - 2;
  for (let parent = scrollContainer || (customRect ? target : target.parentElement); parent; parent = parent.parentElement) {
    const style = win.getComputedStyle(parent), bounds = parent.getBoundingClientRect();
    if (parent === scope || /auto|scroll|hidden|clip/.test(style.overflowX)) {
      left = Math.max(left, bounds.left + parent.clientLeft);
      clipRight = Math.min(clipRight, bounds.left + parent.clientLeft + parent.clientWidth);
      right = Math.min(right, clipRight);
    }
    if (parent === scope || /auto|scroll|hidden|clip/.test(style.overflowY)) {
      clipTop = Math.max(clipTop, bounds.top + parent.clientTop);
      top = Math.max(top, clipTop);
      bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
    }
  }
  return rect.width > 0 && rect.height > 0 && right > left && bottom > top
    ? { left, top, right, bottom, clipTop, clipRight } : null;
}

function addNoteButton(marker, label, noteKey) {
  const doc = marker.ownerDocument;
  const note = annotations.notes?.[noteKey] || '';
  const initialColor = annotations.colors?.[noteKey] || 'blue';
  const theme = markerTheme(noteKey);
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = note ? '说明·' : '说明';
  button.title = note || '查看或编辑改动说明';
  Object.assign(button.style, {height:'18px',marginLeft:'6px',padding:'0 6px',border:'1px solid #ffffff88',borderRadius:'9px',background:note?'#fff':'#ffffff22',color:note?theme.button:'#fff',font:'700 10px/1 inherit',cursor:'pointer',pointerEvents:'auto'});
  button.addEventListener('pointerdown', event => event.stopPropagation());
  button.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    doc.querySelector('.editor-change-note')?.remove();
    const panel = doc.createElement('div');
    panel.className = 'editor-change-note';
    Object.assign(panel.style, {boxSizing:'border-box',position:'fixed',zIndex:'2147483647',width:'min(520px, calc(100vw - 16px))',padding:'12px',border:'1px solid #b8d3ee',borderRadius:'8px',background:'#fff',boxShadow:'0 8px 24px #20354b33',color:'#334f68',pointerEvents:'auto'});
    const heading = doc.createElement('b'); heading.textContent = '改动说明';
    Object.assign(heading.style, {display:'block',marginBottom:'7px',fontSize:'12px'});
    const textarea = doc.createElement('textarea'); textarea.value = note; textarea.maxLength = 2000;
    textarea.placeholder = '记录这项改动的原因、口径或需要注意的事项…';
    Object.assign(textarea.style, {boxSizing:'border-box',display:'block',width:'100%',minHeight:'68px',height:'68px',padding:'7px 8px',resize:'none',overflowY:'hidden',border:'1px solid #d8e3ec',borderRadius:'6px',outlineColor:'#2f80ed',color:'#334f68',font:'12px/1.5 inherit'});
    let selectedColor = initialColor;
    const colorRow = doc.createElement('div');
    Object.assign(colorRow.style, {display:'flex',alignItems:'center',gap:'7px',marginTop:'8px',fontSize:'11px'});
    const colorTitle = doc.createElement('span'); colorTitle.textContent = '标记颜色';
    Object.assign(colorTitle.style, {marginRight:'2px',color:'#657b90',fontWeight:'700'});
    const colorButtons = ['blue','red'].map(color => {
      const choice = doc.createElement('button');
      choice.type = 'button'; choice.textContent = color === 'blue' ? '蓝色' : '红色'; choice.dataset.color = color;
      const paint = () => Object.assign(choice.style, {height:'24px',padding:'0 9px',border:`1px solid ${color === 'red' ? '#e5484d' : '#2f80ed'}`,borderRadius:'12px',background:selectedColor===color?(color==='red'?'#e5484d':'#2f80ed'):'#fff',color:selectedColor===color?'#fff':(color==='red'?'#c9343a':'#246dcc'),font:'700 11px/1 inherit',cursor:'pointer'});
      choice.addEventListener('click', colorEvent => { colorEvent.preventDefault(); colorEvent.stopPropagation(); selectedColor = color; colorButtons.forEach(item => item.paint()); });
      choice.paint = paint; paint(); return choice;
    });
    colorRow.append(colorTitle, ...colorButtons);
    const actions = doc.createElement('div'); Object.assign(actions.style, {display:'flex',justifyContent:'flex-end',gap:'6px',marginTop:'8px'});
    const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消';
    const save = doc.createElement('button'); save.type = 'button'; save.textContent = '保存说明';
    [cancel, save].forEach(action => Object.assign(action.style, {height:'25px',padding:'0 9px',border:'1px solid #cad9e5',borderRadius:'5px',background:'#fff',color:'#526b81',font:'700 11px/1 inherit',cursor:'pointer'}));
    Object.assign(save.style, {borderColor:'#2f80ed',background:'#2f80ed',color:'#fff'});
    cancel.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); panel.remove(); });
    save.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const value = textarea.value.trim();
      if (value) annotations.notes[noteKey] = value; else delete annotations.notes[noteKey];
      if (selectedColor === 'blue') delete annotations.colors[noteKey];
      else annotations.colors[noteKey] = selectedColor;
      panel.remove(); saveAnnotations(); renderChangeMarkers();
    });
    actions.append(cancel, save); panel.append(heading, textarea, colorRow, actions);
    (doc.getElementById('editor-change-overlay') || doc.body).appendChild(panel);
    const positionPanel = () => {
      const labelRect = label.getBoundingClientRect(), panelRect = panel.getBoundingClientRect();
      panel.style.top = `${Math.max(8, labelRect.top - panelRect.height - 8)}px`;
      panel.style.left = `${Math.max(8, Math.min(labelRect.left, doc.defaultView.innerWidth - panelRect.width - 8))}px`;
    };
    const growTextarea = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight + 2}px`;
      positionPanel();
    };
    textarea.addEventListener('input', growTextarea);
    growTextarea();
    textarea.focus();
  });
  label.appendChild(button);
}

function annotationCardNote(box, index, theme) {
  const noteKey = annotationNoteKey(box);
  const card = document.createElement('article');
  card.className = 'annotation-card';
  card.dataset.annotationId = box.id;
  card.style.borderColor = theme.name === 'red' ? '#efb4b4' : '#efdcaa';
  const number = document.createElement('span');
  number.className = 'annotation-card-number';
  number.textContent = String(index);
  number.style.background = theme.solid;
  const title = document.createElement('div');
  title.className = 'annotation-card-title';
  const titleText = document.createElement('span');
  titleText.textContent = `改动 ${index}`;
  const edit = document.createElement('button');
  edit.type = 'button'; edit.textContent = '编辑说明';
  title.append(titleText, edit);
  const note = document.createElement('p');
  note.className = 'annotation-card-note';
  const value = annotations.notes?.[noteKey] || '';
  note.textContent = value || '尚未填写说明';
  if (!value) note.classList.add('annotation-card-empty');
  const editor = document.createElement('div'); editor.hidden = true;
  const textarea = document.createElement('textarea');
  textarea.maxLength = 2000; textarea.value = value;
  textarea.placeholder = '记录这项改动的原因、口径或需要注意的事项…';
  const actions = document.createElement('div'); actions.className = 'annotation-card-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消';
  const save = document.createElement('button'); save.type = 'button'; save.textContent = '保存说明'; save.className = 'primary';
  actions.append(cancel, save); editor.append(textarea, actions);
  const openEditor = event => {
    event?.preventDefault(); event?.stopPropagation();
    editor.hidden = false; note.hidden = true; edit.hidden = true;
    textarea.focus({preventScroll:true});
  };
  edit.addEventListener('pointerdown', event => event.stopPropagation());
  edit.addEventListener('click', openEditor);
  cancel.addEventListener('click', event => { event.stopPropagation(); editor.hidden = true; note.hidden = false; edit.hidden = false; textarea.value = annotations.notes?.[noteKey] || ''; });
  save.addEventListener('click', event => {
    event.stopPropagation();
    const next = textarea.value.trim();
    if (next) annotations.notes[noteKey] = next; else delete annotations.notes[noteKey];
    editor.hidden = true; note.hidden = false; edit.hidden = false;
    note.textContent = next || '尚未填写说明'; note.classList.toggle('annotation-card-empty', !next);
    saveAnnotations(); renderChangeMarkers();
  });
  card.addEventListener('click', event => {
    if (event.target.closest('button,textarea')) return;
    annotationList.querySelectorAll('.annotation-card').forEach(item => item.classList.toggle('active', item === card));
  });
  card.append(number, title, note, editor);
  return card;
}

function drawAnnotationConnectors() {
  if (!annotationRail || annotationRail.hidden || !annotationLayout.length) { annotationConnectors.replaceChildren(); return; }
  const area = canvasArea.getBoundingClientRect();
  const frameBounds = frame.getBoundingClientRect();
  const scale = frameBounds.width / Math.max(1, frame.clientWidth);
  annotationConnectors.setAttribute('viewBox', `0 0 ${Math.max(1, area.width)} ${Math.max(1, area.height)}`);
  annotationConnectors.replaceChildren();
  annotationLayout.forEach(({box, rect, theme}) => {
    const card = annotationList.querySelector(`[data-annotation-id="${CSS.escape(box.id)}"]`);
    if (!card) return;
    const marker = frameDocument()?.querySelector(`.editor-change-marker[data-annotation-id="${CSS.escape(box.id)}"]`);
    const markerBounds = marker?.getBoundingClientRect();
    const sourceRect = markerBounds && markerBounds.width > 0 ? markerBounds : rect;
    const cardBounds = card.getBoundingClientRect();
    const startX = frameBounds.left + sourceRect.right * scale - area.left;
    const startY = frameBounds.top + ((sourceRect.top + sourceRect.bottom) / 2) * scale - area.top;
    const endX = cardBounds.left - area.left;
    const endY = cardBounds.top + cardBounds.height / 2 - area.top;
    const bend = Math.max(28, (endX - startX) * .45);
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`);
    path.setAttribute('fill','none'); path.setAttribute('stroke',theme.solid); path.setAttribute('stroke-width','2.5'); path.setAttribute('stroke-linecap','round'); path.setAttribute('opacity','.78');
    const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
    dot.setAttribute('cx',String(startX)); dot.setAttribute('cy',String(startY)); dot.setAttribute('r','5'); dot.setAttribute('fill',theme.solid); dot.setAttribute('stroke','#fff'); dot.setAttribute('stroke-width','2');
    annotationConnectors.append(path, dot);
  });
}

function renderAnnotationRail(layout) {
  if (!annotationRail || !annotationList) return;
  annotationLayout = layout;
  annotationList.replaceChildren();
  annotationCount.textContent = `${layout.length} 项`;
  layout.forEach(({box, index, theme}) => annotationList.appendChild(annotationCardNote(box, index, theme)));
  const open = showChanges && layout.length > 0;
  annotationRail.hidden = layout.length === 0;
  canvasArea.classList.toggle('annotation-open', open);
  requestAnimationFrame(drawAnnotationConnectors);
}

function annotationSelector(element) {
  const parts = [];
  const css = element?.ownerDocument.defaultView.CSS;
  while (element && element !== element.ownerDocument.body) {
    if (element.id) { parts.unshift(`#${css.escape(element.id)}`); break; }
    const siblings = [...element.parentElement.children].filter(node => node.tagName === element.tagName);
    parts.unshift(`${element.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(element) + 1})`);
    element = element.parentElement;
  }
  return parts.join(' > ') || 'body';
}

function activeTabValue(group) {
  const active = group?.querySelector('button.active, button[aria-selected="true"], button[aria-pressed="true"]');
  return active?.textContent.trim().replace(/\s+/g, ' ') || '';
}

function tabViewForTarget(target) {
  if (!target) return null;
  const doc = target.ownerDocument;
  const css = doc.defaultView.CSS;
  const groups = [...doc.querySelectorAll('.compact-segment, .tabs, .ha-rank-tabs, .ha-honor-tabs, .ha-honor-query-tabs, .human-admin-tabs')]
    .filter(group => activeTabValue(group));
  const ancestors = node => {
    const result = [];
    for (let current = node; current; current = current.parentElement) result.push(current);
    return result;
  };
  const targetAncestors = ancestors(target);
  let best = null;
  groups.forEach(group => {
    const groupAncestors = ancestors(group);
    const common = targetAncestors.find(node => groupAncestors.includes(node));
    if (!common) return;
    const distance = targetAncestors.indexOf(common) + groupAncestors.indexOf(common);
    if (distance > 8 || (best && best.distance <= distance)) return;
    const aria = group.getAttribute('aria-label');
    const selector = group.id
      ? `#${css.escape(group.id)}`
      : aria
        ? `[aria-label=${JSON.stringify(aria)}]`
        : annotationSelector(group);
    best = { selector, value:activeTabValue(group), distance };
  });
  return best ? { selector:best.selector, value:best.value } : null;
}

function boxViewMatches(doc, box) {
  if (!box.view?.selector || !box.view?.value) return true;
  return activeTabValue(queryPatchElement(doc, box.view.selector)) === box.view.value;
}

function cancelBoxSelection() {
  if (selectionKeyHandler) selectionLayer?.ownerDocument.removeEventListener('keydown', selectionKeyHandler);
  selectionKeyHandler = null;
  selectionLayer?.remove();
  selectionLayer = null;
  boxToggle.classList.remove('active');
  boxToggle.setAttribute('aria-pressed', 'false');
  boxToggle.textContent = '框选改动';
}

function startBoxSelection() {
  const doc = frameDocument();
  if (!doc?.body) return;
  const scope = activeChangeScope(doc);
  const layer = doc.createElement('div');
  layer.id = 'editor-box-selection';
  Object.assign(layer.style, {position:'fixed',inset:'0',zIndex:'2147483647',cursor:'crosshair',touchAction:'none'});
  const ghost = doc.createElement('div');
  Object.assign(ghost.style, {position:'fixed',border:'2px dashed #2f80ed',background:'#2f80ed18',pointerEvents:'none',display:'none'});
  layer.appendChild(ghost);
  doc.body.appendChild(layer);
  selectionLayer = layer;
  boxToggle.classList.add('active');
  boxToggle.setAttribute('aria-pressed', 'true');
  boxToggle.textContent = '取消框选';
  showToast('请在画布中拖动框选，按 Esc 可取消');
  let start;
  const underlying = event => {
    layer.style.pointerEvents = 'none';
    const overlay = doc.getElementById('editor-change-overlay');
    if (overlay) overlay.hidden = true;
    const target = doc.elementFromPoint(event.clientX, event.clientY);
    if (overlay) overlay.hidden = false;
    layer.style.pointerEvents = 'auto';
    return target;
  };
  const coordinates = event => {
    const bounds = scope?.getBoundingClientRect() || {left:0,top:0,right:doc.defaultView.innerWidth,bottom:doc.defaultView.innerHeight};
    return {x:Math.max(bounds.left,Math.min(event.clientX,bounds.right)),y:Math.max(bounds.top,Math.min(event.clientY,bounds.bottom))};
  };
  layer.addEventListener('pointerdown', event => {
    const target = underlying(event);
    if (scope && !scope.contains(target)) return;
    start = {...coordinates(event), target};
    layer.setPointerCapture(event.pointerId);
    event.preventDefault(); event.stopPropagation();
  });
  layer.addEventListener('pointermove', event => {
    if (!start) return;
    const end = coordinates(event);
    Object.assign(ghost.style, {display:'block',left:`${Math.min(start.x,end.x)}px`,top:`${Math.min(start.y,end.y)}px`,width:`${Math.abs(start.x-end.x)}px`,height:`${Math.abs(start.y-end.y)}px`});
  });
  layer.addEventListener('pointerup', event => {
    if (!start) return;
    const end = coordinates(event), target = underlying(event);
    const left = Math.min(start.x,end.x), top = Math.min(start.y,end.y);
    const width = Math.abs(start.x-end.x), height = Math.abs(start.y-end.y);
    let anchor = start.target;
    while (anchor?.parentElement && (!anchor.contains(target) || anchor.getBoundingClientRect().left > left || anchor.getBoundingClientRect().top > top || anchor.getBoundingClientRect().right < left + width || anchor.getBoundingClientRect().bottom < top + height)) anchor = anchor.parentElement;
    cancelBoxSelection();
    if (width < 8 || height < 8 || !anchor || (scope && !scope.contains(anchor))) {
      showToast('未添加：请拖出一个有效区域');
      return;
    }
    const selectionRect = {left,top,right:left+width,bottom:top+height};
    const scrollContainer = boxScrollContainer(anchor, selectionRect);
    const storageAnchor = scrollContainer || anchor;
    const bounds = storageAnchor.getBoundingClientRect();
    const anchorWidth = Math.max(storageAnchor.scrollWidth, bounds.width);
    const anchorHeight = Math.max(storageAnchor.scrollHeight, bounds.height);
    annotations.boxes.push({
      id:`box-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      selector:annotationSelector(storageAnchor),
      cockpit:markerCockpit(doc),
      context:markerContext(scope),
      view:tabViewForTarget(storageAnchor),
      x:(left-bounds.left+storageAnchor.scrollLeft)/anchorWidth,
      y:(top-bounds.top+storageAnchor.scrollTop)/anchorHeight,
      width:width/anchorWidth,
      height:height/anchorHeight,
    });
    saveAnnotations();
    renderChangeMarkers();
    showToast('手动改动点已保存到项目');
  });
  layer.addEventListener('pointercancel', cancelBoxSelection);
  selectionKeyHandler = event => { if (event.key === 'Escape') cancelBoxSelection(); };
  doc.addEventListener('keydown', selectionKeyHandler);
}

function scheduleChangeRefresh(event) {
  // Hover transitions inside the annotation UI must not replace active controls.
  if (!['scroll','resize'].includes(event?.type) && event?.target?.closest?.('#editor-change-overlay, #editor-box-selection')) return;
  cancelAnimationFrame(changeRefreshTimer);
  changeRefreshTimer = requestAnimationFrame(renderChangeMarkers);
}

function installChangeTracking() {
  if (trackedFrameWindow === frame.contentWindow) return;
  trackedFrameWindow = frame.contentWindow;
  trackedFrameWindow.addEventListener('scroll', scheduleChangeRefresh, true);
  trackedFrameWindow.document?.addEventListener('scroll', scheduleChangeRefresh, true);
  trackedFrameWindow.addEventListener('resize', scheduleChangeRefresh);
  trackedFrameWindow.addEventListener('transitionrun', scheduleChangeRefresh, true);
  trackedFrameWindow.addEventListener('transitionend', scheduleChangeRefresh, true);
}

canvasScroll.addEventListener('scroll', scheduleChangeRefresh);
window.addEventListener('resize', scheduleChangeRefresh);

function renderChangeMarkers() {
  if (!showChanges) return;
  const doc = frameDocument();
  if (!doc?.body) return;
  let overlay = doc.getElementById('editor-change-overlay');
  if (!overlay) {
    overlay = doc.createElement('div'); overlay.id = 'editor-change-overlay';
    Object.assign(overlay.style, {position:'fixed',inset:'0',zIndex:'2147483646',pointerEvents:'none',overflow:'visible'});
    doc.body.appendChild(overlay); installChangeTracking();
  }
  overlay.replaceChildren();
  const scope = activeChangeScope(doc);
  const dialogScopeMessage = '当前正在查看明细弹窗，关闭后可调整页面上的改动框';
  boxToggle.title = scope ? dialogScopeMessage : '在画布中框选改动范围';
  const items = [];
  annotations.boxes.filter(box => box.cockpit === markerCockpit(doc) && box.context === markerContext(scope) && boxViewMatches(doc, box)).forEach(box => {
    const target = queryPatchElement(doc, box.selector);
    if (!target) return;
    const bounds = target.getBoundingClientRect(), width = Math.max(target.scrollWidth, bounds.width), height = Math.max(target.scrollHeight, bounds.height);
    const rawRect = {left:bounds.left + box.x * width, top:bounds.top + box.y * height};
    rawRect.right = rawRect.left + box.width * width; rawRect.bottom = rawRect.top + box.height * height;
    const scrollContainer = boxScrollContainer(target, rawRect);
    if (scrollContainer && !Number.isFinite(box.nestedScrollLeft)) {
      const scrollBounds = scrollContainer.getBoundingClientRect();
      const looksAnchoredToRightEdge = rawRect.right >= scrollBounds.right - 3;
      box.nestedScrollLeft = looksAnchoredToRightEdge ? scrollContainer.scrollWidth - scrollContainer.clientWidth : scrollContainer.scrollLeft;
    }
    if (scrollContainer && !Number.isFinite(box.nestedScrollTop)) box.nestedScrollTop = scrollContainer.scrollTop;
    const left = rawRect.left - target.scrollLeft - (scrollContainer ? scrollContainer.scrollLeft - box.nestedScrollLeft : 0);
    const top = rawRect.top - target.scrollTop - (scrollContainer ? scrollContainer.scrollTop - box.nestedScrollTop : 0);
    items.push({target, box, scrollContainer, customRect:{left,top,right:left+box.width*width,bottom:top+box.height*height,width:box.width*width,height:box.height*height}});
  });
  const visibleItems = [];
  items.forEach(({target, box, customRect, scrollContainer}) => {
    const rect = visibleChangeRect(target, scope, customRect, scrollContainer);
    if (!rect) return;
    const index = visibleItems.length + 1;
    const noteKey = annotationNoteKey(box), theme = markerTheme(noteKey);
    visibleItems.push({target, box, rect, index, theme});
    const marker = doc.createElement('div'); marker.className = 'editor-change-marker';
    marker.dataset.annotationId = box.id;
    Object.assign(marker.style, {position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.right-rect.left}px`,height:`${rect.bottom-rect.top}px`,border:`2px solid ${theme.solid}`,borderRadius:'9px',boxShadow:`0 0 0 2px ${theme.shadow}`,pointerEvents:'none'});
    const badge = doc.createElement('button');
    badge.type = 'button'; badge.textContent = String(index);
    badge.title = '查看右侧改动说明'; badge.setAttribute('aria-label', `查看第 ${index} 项改动说明`);
    Object.assign(badge.style, {position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',zIndex:'2',width:'28px',height:'28px',padding:'0',border:`2px solid #fff`,borderRadius:'50%',background:theme.solid,color:'#fff',boxShadow:`0 2px 7px ${theme.shadow}`,font:'700 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif',cursor:'pointer',pointerEvents:'auto'});
    badge.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const card = annotationList.querySelector(`[data-annotation-id="${CSS.escape(box.id)}"]`);
      card?.scrollIntoView({block:'nearest'}); card?.classList.add('active');
      setTimeout(() => card?.classList.remove('active'), 1200);
    });
    const editButton = doc.createElement('button');
    editButton.type = 'button'; editButton.textContent = '✎'; editButton.title = '选中并调整改动框范围'; editButton.setAttribute('aria-label', '选中并调整改动框范围');
    Object.assign(editButton.style, {position:'absolute',right:'-7px',top:'-9px',zIndex:'3',width:'18px',height:'18px',padding:'0',border:`1px solid ${theme.solid}`,borderRadius:'50%',background:'#fff',color:theme.button,font:'700 10px/1 inherit',cursor:'pointer',pointerEvents:'auto'});
    editButton.addEventListener('pointerdown', event => event.stopPropagation());
    editButton.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); selectedManualBoxId = box.id; saveAnnotations(); renderChangeMarkers();
    });
    marker.append(badge, editButton);
    addDismissButton(marker, () => {
      annotations.boxes = annotations.boxes.filter(item => item.id !== box.id);
      delete annotations.notes?.[noteKey];
      delete annotations.colors?.[noteKey];
    }, theme);
    if (selectedManualBoxId === box.id) addResizeHandles(marker, box, target, rect, theme);
    overlay.appendChild(marker);
  });
  renderAnnotationRail(visibleItems);
}

function removeChangeMarkers() {
  cancelAnimationFrame(changeRefreshTimer);
  frameDocument()?.getElementById('editor-change-overlay')?.remove();
  annotationLayout = [];
  annotationRail?.setAttribute('hidden','');
  canvasArea?.classList.remove('annotation-open');
  annotationList?.replaceChildren();
  annotationConnectors?.replaceChildren();
}

function setChangesVisible(visible) {
  showChanges = visible;
  changesToggle.setAttribute('aria-pressed', String(visible));
  changesToggle.textContent = visible ? '隐藏手动标记' : '显示手动标记';
  if (visible) renderChangeMarkers(); else removeChangeMarkers();
}

function injectEditorStyles(doc) {
  doc.getElementById('ve-editor-style')?.remove();
  const style = doc.createElement('style');
  style.id = 've-editor-style';
  style.textContent = `
    body.ve-edit-mode [data-ve-reorderable="true"] { cursor:grab; }
    body.ve-edit-mode [data-ve-reorderable="true"]:active { cursor:grabbing; }
    body.ve-edit-mode .ve-selected { outline:2px solid #2d79e6 !important; outline-offset:2px !important; box-shadow:0 0 0 5px #2d79e622 !important; }
    body.ve-edit-mode .ve-hover { outline:1px solid #5592e8 !important; outline-offset:2px !important; }
    body.ve-edit-mode .ve-container-preview { outline:3px solid #e34299 !important; outline-offset:-3px !important; }
    body.ve-edit-mode .ve-drop-target { outline:3px solid #13a67b !important; outline-offset:3px !important; background-color:#ecfcf5 !important; }
    body.ve-edit-mode.ve-pointer-move .ve-selected { cursor:move !important; touch-action:none; }
    body.ve-edit-mode.ve-pointer-select, body.ve-edit-mode.ve-pointer-select * { cursor:crosshair !important; user-select:none !important; touch-action:none; }
    body.ve-edit-mode .ve-dragging { opacity:.45 !important; }
    body.ve-edit-mode [contenteditable="true"] { cursor:text !important; outline:2px solid #18a57b !important; background:#effcf8 !important; color:#29435d !important; }
    body.ve-preview-mode .ve-selected, body.ve-preview-mode .ve-hover { outline:0 !important; box-shadow:none !important; }
  `;
  doc.head.appendChild(style);
}

function prepareReorderables(doc) {
  doc.querySelectorAll('[data-ve-node],.panel,.ha-metric,.ha-overtime-card,.ha-section,.ha-topic,.ha-care,.ha-business-role,.finance-kpi,.finance-stat,.finance-block,.procurement-metric,.live-card').forEach(element => {
    if (!element.dataset.veSelector) element.dataset.veSelector = selectorFor(element);
    if (!element.dataset.veParentSelector && element.parentElement) element.dataset.veParentSelector = selectorFor(element.parentElement);
    element.dataset.veReorderable = 'true';
    element.draggable = mode === 'edit' && !isLocked(element);
  });
}

function setupFrame() {
  if(!projectReady || !projectConfig)return;
  let doc;
  try {
    doc=frameDocument();
    const actual=new URL(frame.contentWindow.location.href),expected=new URL(projectConfig.url,location.href);
    if(actual.pathname!==expected.pathname) {
      if(projectId!=='builtin') {
        const prefix=`/project/${projectId}/`;
        if(actual.pathname.startsWith(prefix)) {
          const entry=decodeURIComponent(actual.pathname.slice(prefix.length));
          if(projectConfig.pages.includes(entry)){switchProjectPage(projectId,entry,actual.hash);return;}
        }
      }
      if(actual.href!=='about:blank')showProjectError('当前链接打开了其他预览页面。点击“刷新代码”返回所选 HTML 后继续编辑。');
      return;
    }
  } catch {showProjectError('当前预览已离开本地项目，点击“刷新代码”返回编辑页面。');return;}
  if (!doc?.body) return;
  if (doc.body.dataset.veEditorReady === 'true') return;
  doc.body.dataset.veEditorReady = 'true';
  clearTimeout(mutationTimer);
  patchObserver?.disconnect();
  patchEngine = createVisualPatchEngine(doc);
  injectEditorStyles(doc);
  doc.body.classList.toggle('ve-edit-mode', mode === 'edit');
  doc.body.classList.toggle('ve-preview-mode', mode !== 'edit');
  doc.body.classList.toggle('ve-pointer-move',mode==='edit' && !!pointerMode);
  prepareReorderables(doc);

  doc.addEventListener('scroll',()=>{clearHover();if(moveGesture || sweepGesture)cancelMovement();updateResizeHandle();},true);
  doc.addEventListener('pointerdown', beginSweepSelection, true);
  doc.addEventListener('pointermove', updateSweepSelection, true);
  doc.addEventListener('pointerup', finishSweepSelection, true);
  doc.addEventListener('pointerdown', beginPointerMovement, true);
  doc.addEventListener('pointermove', updatePointerMovement, true);
  doc.addEventListener('pointerup', endPointerMovement, true);
  doc.addEventListener('pointercancel', cancelMovement, true);
  doc.addEventListener('keydown', handleEditorKey);
  doc.addEventListener('click', handleFrameClick, true);
  doc.addEventListener('dblclick', handleFrameDoubleClick, true);
  doc.addEventListener('pointermove', handleFrameHover, true);
  doc.addEventListener('mouseout', handleFrameHoverOut, true);
  doc.addEventListener('dragstart', handleDragStart, true);
  doc.addEventListener('dragover', handleDragOver, true);
  doc.addEventListener('drop', handleDrop, true);
  doc.addEventListener('dragend', handleDragEnd, true);

  const observer = new frame.contentWindow.MutationObserver(records => {
    if (draggedElement || moveGesture || resizeGesture) return;
    const externalChange = records.some(record => !record.target.closest?.('#editor-change-overlay'));
    if (!externalChange) return;
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      patchEngine.capture();
      applyAllPatches();
      prepareReorderables(doc);
      updateSaveability();
      if(selectedElements.size)refreshSelection();
    }, 80);
  });
  patchObserver = observer;
  observer.observe(doc.body, { childList:true, subtree:true });

  applyAllPatches();
  prepareReorderables(doc);
  clearSelection();
  updateSaveability();
  if (showChanges) renderChangeMarkers();
}

function handleFrameClick(event) {
  if (suppressNextClick) {event.preventDefault();event.stopImmediatePropagation();return;}
  if (mode !== 'edit') return;
  if(event.target.closest?.('[contenteditable="true"]'))return;
  const choices=event.altKey && !event.shiftKey ? pickElementsAtPoint(frameDocument(),event.clientX,event.clientY,{cardSelector:CARD_SELECTOR,exact:true}) : null;
  const index=choices?.indexOf(selectedElement) ?? -1;
  const target=choices ? choices[(index+1)%choices.length] : pickCanvasTarget(event);
  if (!target) {
    if(event.target.closest?.('[data-ve-locked],#editor-change-overlay,#editor-box-selection')){event.preventDefault();event.stopImmediatePropagation();return;}
    commitCardForm();clearSelection();
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  selectElement(target, { additive:event.shiftKey });
}

let hoveredElement = null;
function pickCanvasTarget(event) {
  return pickElementAtPoint(frameDocument(),event.clientX,event.clientY,{cardSelector:CARD_SELECTOR,exact:event.altKey});
}
function clearHover() {
  hoveredElement?.classList.remove('ve-hover');hoveredElement=null;
  document.getElementById('editor-hover-label')?.remove();
}
function handleFrameHover(event) {
  if(mode!=='edit' || moveGesture || sweepGesture || draggedElement || resizeGesture)return;
  const target=pickCanvasTarget(event);
  if(target===hoveredElement)return;
  clearHover();
  if(!target || target===selectedElement)return;
  hoveredElement=target;target.classList.add('ve-hover');
  const label=document.createElement('div');label.id='editor-hover-label';label.setAttribute('aria-hidden','true');
  const kind=target.matches('svg,img,canvas,video')?'图像 / 图标':target.matches(CARD_SELECTOR)?'卡片':target.matches('input,textarea,select')?'表单控件':target.textContent.trim() && target.children.length<2?'文字':'组件';
  label.textContent=`${kind} · ${elementLabel(target).slice(0,24)}`;
  const bounds=target.getBoundingClientRect(),f=frame.getBoundingClientRect(),scale=f.width/frame.clientWidth,c=canvasScroll.getBoundingClientRect();
  Object.assign(label.style,{position:'fixed',left:`${Math.min(c.right-190,Math.max(c.left,f.left+bounds.left*scale))}px`,top:`${Math.max(c.top,f.top+bounds.top*scale-24)}px`,pointerEvents:'none',zIndex:'8',padding:'3px 7px',borderRadius:'4px',background:'#2468d8',color:'#fff',fontSize:'10px',maxWidth:'190px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'});
  document.body.append(label);
}
function handleFrameHoverOut(event) {
  if(!event.relatedTarget || !frameDocument().documentElement.contains(event.relatedTarget))clearHover();
}

function handleFrameDoubleClick(event) {
  if (mode !== 'edit' || event.target.closest?.('[contenteditable="true"]')) return;
  const target = pickCanvasTarget(event);
  if (!target || isLocked(target) || target.childElementCount > 0 || target.matches('input,textarea,select,img,svg,video,canvas')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  selectElement(target);
  if(!allowChange(target,{text:target.textContent.trim()}))return;
  const originalText=target.textContent;
  const doc=target.ownerDocument;
  const point=doc.caretPositionFromPoint?.(event.clientX,event.clientY);
  let range=doc.createRange();
  if(point && target.contains(point.offsetNode)) {
    range.setStart(point.offsetNode,point.offset);
  } else {
    const hit=doc.caretRangeFromPoint?.(event.clientX,event.clientY);
    if(hit && target.contains(hit.startContainer))range=hit;
    else {range.selectNodeContents(target);range.collapse(false);}
  }
  range.collapse(true);
  target.contentEditable = 'true';
  target.focus();
  const selection = frame.contentWindow.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const finish = () => {
    const text=target.textContent.trim();
    target.contentEditable = 'false';
    target.textContent=originalText;
    commitElementChange(target, { text });
    target.removeEventListener('blur', finish);
    target.removeEventListener('keydown', onKeyDown);
  };
  const onKeyDown = keyboardEvent => {
    if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
      target.blur();
    }
    if (keyboardEvent.key === 'Escape') reloadFrame();
  };
  target.addEventListener('blur', finish);
  target.addEventListener('keydown', onKeyDown);
}

function handleDragStart(event) {
  if (mode !== 'edit') return;
  if (pointerMode || selectedElements.size > 1 || event.shiftKey) { event.preventDefault(); return; }
  const target = pickCanvasTarget(event);
  if (!isReorderable(target) || isLocked(target)) {
    event.preventDefault();
    return;
  }
  if(!allowReorder(target.parentElement)){event.preventDefault();return;}
  clearTimeout(mutationTimer);
  draggedElement = target;
  selectElement(target);
  target.classList.add('ve-dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', selectorFor(target));
}

function handleDragOver(event) {
  if (paletteType) {handlePaletteOver(event);return;}
  if (!draggedElement || mode !== 'edit') return;
  const target = event.target.closest?.('[data-ve-reorderable="true"]');
  if (!target || target === draggedElement || target.parentElement !== draggedElement.parentElement || !isReorderable(target)) return;
  event.preventDefault();
  const rect = target.getBoundingClientRect();
  const vertical = rect.height >= rect.width || frame.contentWindow.getComputedStyle(target.parentElement).display !== 'grid';
  const after = vertical ? event.clientY > rect.top + rect.height / 2 : event.clientX > rect.left + rect.width / 2;
  target.parentElement.insertBefore(draggedElement, after ? target.nextSibling : target);
}

function handleDrop(event) {
  if(paletteType) {handlePaletteDrop(event);return;}
  if (!draggedElement) return;
  event.preventDefault();
  const parent = draggedElement.parentElement;
  if(!allowReorder(parent)){draggedElement=null;reloadFrame();return;}
  rememberSiblingOrder(parent);
  persistState();
  draggedElement.classList.remove('ve-dragging');
  draggedElement = null;
  showToast('模块顺序已调整');
}

function handleDragEnd() {
  draggedElement?.classList.remove('ve-dragging');
  draggedElement = null;
  applyAllPatches();
}

function selectElement(element, { additive=false } = {}) {
  clearHover();
  if(isLocked(element)){showToast('此图层已锁定，请先在左侧解锁');return;}
  commitCardForm();
  if(!additive) {
    selectedElements.forEach(node=>node.classList.remove('ve-selected'));
    selectedElements.clear();
  }
  if(additive && selectedElements.has(element)) {
    selectedElements.delete(element);element.classList.remove('ve-selected');
    selectedElement=[...selectedElements].at(-1) || null;
  } else {
    // An ancestor and descendant must not receive the same batch change twice.
    for(const node of selectedElements) if(node.contains(element)||element.contains(node)) {node.classList.remove('ve-selected');selectedElements.delete(node);}
    selectedElements.add(element);selectedElement=element;
  }
  if(!selectedElement){clearSelection();return;}
  refreshSelection();
}
function refreshSelection() {
  selectedElements=new Set(selectedList());
  if(!selectedElements.size){clearSelection();return;}
  if(!selectedElements.has(selectedElement))selectedElement=[...selectedElements].at(-1);
  for(const element of selectedElements) {element.classList.remove('ve-hover');element.classList.add('ve-selected');}
  restoreSaveabilityControls();
  editorMain.classList.add('inspector-open');inspectorFields.hidden=false;resizeCanvas();
  selectedName.textContent=selectedElements.size>1 ? `已选择 ${selectedElements.size} 个元素` : elementLabel(selectedElement);
  updateSelectionControls(selectedElement);renderCardForm(selectedElement);fillInspector(selectedElement);updateMovementReadout();fillStructureInspector();renderSaveability();scheduleLayers();
  requestAnimationFrame(updateTextToolbar);
}
function clearSelection() {
  document.getElementById('text-toolbar').hidden=true;
  clearHover();
  finishResize(false);
  setPointerMode(mode==='edit'?'move':'');
  selectedElements.forEach(element=>element.classList.remove('ve-selected'));
  selectedElements.clear();cardInputs=[];selectedElement=null;
  editorMain.classList.remove('inspector-open');inspectorFields.hidden=true;resizeCanvas();
  selectionPath.textContent='尚未选择元素';
  scheduleLayers();
}

function rgbToHex(color, fallback = '#ffffff') {
  const match = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  return `#${match.slice(1, 4).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`;
}

function editableTextTargets(element) {
  if(selectedElements.size!==1 || isLocked(element))return [];
  return textTargetsForElement(element,frameDocument());
}
function fillInspector(element) {
  const style = frame.contentWindow.getComputedStyle(element);
  const textTargets=editableTextTargets(element);
  fields.text.disabled = !textTargets.length;
  fields.text.value = textTargets.map(target=>target.value).join(' ');
  document.getElementById('text-section').hidden = !textTargets.length;
  fields.fontSize.value = Math.round(parseFloat(styleSample(element,'fontSize'))) || '';
  fields.fontSize.closest('.property-section').querySelector('h3').textContent=element.matches(CARD_SELECTOR)?'排版 · 卡片标题':'排版';
  fields.fontWeight.value = ['400', '500', '600', '700'].includes(styleSample(element,'fontWeight')) ? styleSample(element,'fontWeight') : '';
  fields.color.value = rgbToHex(styleSample(element,'color'), '#17243a');
  fields.colorText.value = fields.color.value;
  fields.textAlign.value = ['left', 'center', 'right'].includes(style.textAlign) ? style.textAlign : '';
  fields.background.value = rgbToHex(style.backgroundColor, '#ffffff');
  fields.backgroundText.value = fields.background.value;
  fields.radius.value = Math.round(parseFloat(style.borderRadius)) || 0;
  fields.opacity.value = Math.round(Number(style.opacity) * 100);
  fields.width.value = element.style.width || '';
  fields.height.value = element.style.height || '';
  const propertyFields={fontSize:'fontSize',fontWeight:'fontWeight',color:'colorText',textAlign:'textAlign',backgroundColor:'backgroundText',borderRadius:'radius',opacity:'opacity',width:'width',height:'height'};
  for(const [property,name] of Object.entries(propertyFields)) {
    const field=fields[name];field.placeholder='';field.title='';
    if(new Set(selectedList().map(node=>styleSample(node,property))).size>1) {
      field.value='';field.placeholder='不同值';field.title='所选元素的属性不同，输入新值可统一修改';
    }
  }

  updateOrderControls();
}

function commitElementChange(element, change) {
  const selector = selectorFor(element);
  const key = elementKey(selector);
  const entry={selector,...change};if(!allowEntries([[key,entry]]))return false;
  state = upsertElementPatch(state, key, entry);
  applyAllPatches();
  persistState();
}

function applyAllPatches() {
  if (!patchEngine) return;
  routePendingEdits();
  patchEngine.apply(mergeSourcePatches(readSourcePatches(frameDocument()), state.patches));
  // MutationObserver callbacks run asynchronously; a boolean guard is insufficient.
  patchObserver?.takeRecords();
  requestAnimationFrame(updateResizeHandle);
  scheduleLayers();
  if (showChanges) scheduleChangeRefresh();
}

function rememberSiblingOrder(parent) {
  const patches = structuredClone(state.patches);
  const parentSelector = selectorFor(parent);
  [...parent.children].forEach((element, index) => {
    if (element.tagName === 'TEMPLATE') return;
    const selector = selectorFor(element);
    const key = elementKey(selector);
    patches[key] = { ...patches[key], selector, position: { parent: parentSelector, index } };
  });
  state = { ...state, patches, past: [...state.past, state.patches], future: [] };
  patchObserver?.takeRecords();
  clearTimeout(mutationTimer);
}

function updateSelectedStyle(styles) {
  if (!selectedElement) return;
  commitCardForm();
  const changes=[];
  for(const element of selectedList()) {
    changes.push({element,styles});
    const title=titleElement(element);
    const typography=Object.fromEntries(Object.entries(styles).filter(([key])=>['fontSize','fontWeight','color'].includes(key)));
    if(title!==element && Object.keys(typography).length)changes.push({element:title,styles:typography});
  }
  commitChanges(changes);fillInspector(selectedElement);
  updateTextToolbar();
}

function updateTextToolbar() {
  const toolbar=document.getElementById('text-toolbar');
  const visible=mode==='edit' && selectedElements.size===1 && selectedElement?.isConnected && !isLocked(selectedElement)
    && !editorMain.classList.contains('ai-open') && isTextToolbarTarget(selectedElement)
;
  toolbar.hidden=!visible;
  if(!visible)return;
  const style=frame.contentWindow.getComputedStyle(selectedElement);
  document.getElementById('text-tool-size').value=Math.round(parseFloat(style.fontSize)) || 16;
  document.getElementById('text-tool-color').value=rgbToHex(style.color,'#17243a');
  document.getElementById('text-tool-background').value=rgbToHex(style.backgroundColor,'#ffffff');
  document.getElementById('text-tool-paste').disabled=!copiedFormat;
  for(const button of toolbar.querySelectorAll('[data-text-action],[data-text-align]')) {
    const action=button.dataset.textAction;
    const active=action==='bold' ? Number(style.fontWeight)>=600 : action==='italic' ? style.fontStyle==='italic'
      : action==='underline' ? style.textDecorationLine.includes('underline')
      : action==='strike' ? style.textDecorationLine.includes('line-through')
      : button.dataset.textAlign ? style.textAlign===button.dataset.textAlign : false;
    button.setAttribute('aria-pressed',String(active));
  }
  const elementBounds=selectedElement.getBoundingClientRect(),frameBounds=frame.getBoundingClientRect();
  const scale=frameBounds.width/frame.clientWidth,canvasBounds=canvasScroll.getBoundingClientRect();
  const left=frameBounds.left+elementBounds.left*scale,top=frameBounds.top+elementBounds.top*scale;
  const bottom=frameBounds.top+elementBounds.bottom*scale;
  const width=toolbar.offsetWidth,height=toolbar.offsetHeight;
  toolbar.style.left=`${Math.round(Math.max(8,Math.min(left,innerWidth-width-8)))}px`;
  toolbar.style.top=`${Math.round(top-height-8<canvasBounds.top ? Math.min(bottom+8,innerHeight-height-8) : top-height-8)}px`;
}

const textToolbar=document.getElementById('text-toolbar');
textToolbar.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button || !selectedElement)return;
  if(button.id==='text-tool-copy') {document.getElementById('copy-format').click();return;}
  if(button.id==='text-tool-paste') {document.getElementById('paste-format').click();return;}
  const style=frame.contentWindow.getComputedStyle(selectedElement);
  const action=button.dataset.textAlign?'align':button.dataset.textAction;
  const value=button.dataset.textAlign || (action==='size-up'?1:action==='size-down'?-1:null);
  updateSelectedStyle(textToolbarStyles(action?.startsWith('size-')?'size-step':action,style,value));
});
document.getElementById('text-tool-preset').addEventListener('change',event=>{
  if(event.target.value)updateSelectedStyle(textToolbarStyles('preset',{},event.target.value));
  event.target.value='';
});
document.getElementById('text-tool-size').addEventListener('change',event=>updateSelectedStyle(textToolbarStyles('size',{},event.target.value)));
document.getElementById('text-tool-color').addEventListener('input',event=>updateSelectedStyle(textToolbarStyles('color',{},event.target.value)));
document.getElementById('text-tool-background').addEventListener('input',event=>updateSelectedStyle(textToolbarStyles('background',{},event.target.value)));

function normalizeSize(value) {
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed;
}

function reloadFrame() {
  clearSelection();
  clearTimeout(layerRenderTimer);
  clearTimeout(mutationTimer);
  patchObserver?.disconnect();
  patchEngine = null;
  cancelBoxSelection();
  removeChangeMarkers();
  trackedFrameWindow = null;
  document.getElementById('project-error').hidden=true;
  const reloadUrl=new URL(currentFrameUrl());
  reloadUrl.searchParams.set('editor-reload',crypto.randomUUID());
  frame.src = reloadUrl.href;
  saveStatus.textContent = `正在重新读取 ${projectEntry} 和本地资源`;
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportHtml() {
  commitCardForm();
  if(!await saveToSource())return;
  if(projectId !== 'builtin') {
    const response=await fetch(projectEndpoint('/api/projects/export'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:1,patches:{},sourceOnly:true})});
    if(!response.ok)throw new Error((await response.json()).error || '项目导出失败');
    download(`${projectConfig.name}-edited.zip`,await response.blob(),'application/zip');
    showToast('已保存原文件并导出开发源码 ZIP（含本地资源）');return;
  }
  const response = await fetch('../prototype.html');
  const source = await response.text();
  if (!response.ok) throw new Error('无法读取 prototype.html');
  const output = await createStandaloneHtml({
    source,
    patches: state.patches,
    fetchImpl: path => fetch(new URL(path === 'compare-versions.html' ? path : `../${path}`, location.href)),
  });
  download('jx-dashboard-visual-edited.html', output, 'text/html;charset=utf-8');
  showToast('已导出包含图标与交互的单文件 HTML');
}

function orderSiblings() {
  return [...(selectedElement?.parentElement?.children||[])].filter(node=>!node.matches('script,style,template') && node.getClientRects().length && !['absolute','fixed'].includes(frame.contentWindow.getComputedStyle(node).position));
}
function updateOrderControls() {
  const single=selectedElements.size===1 && !isLocked(selectedElement);
  const free=single && ['absolute','fixed'].includes(frame.contentWindow.getComputedStyle(selectedElement).position);
  const siblings=orderSiblings(),index=siblings.indexOf(selectedElement);
  document.getElementById('move-up-button').disabled=!single || free || index<=0;
  document.getElementById('move-down-button').disabled=!single || free || index<0 || index===siblings.length-1;
  document.getElementById('order-hint').textContent=free?'这个组件是自由摆放的，直接在画布上拖动即可调整位置。'
    : !single?'选择一个组件，调整它在同一容器中的排列顺序。'
    : `当前第 ${index+1} / ${siblings.length} 个。提前或延后一位，会调整同一容器里的排列顺序。`;
}
function moveSelected(offset) {
  if (!selectedElement || !selectedElement.parentElement || selectedElements.size!==1 || isLocked(selectedElement)) return;
  if(['absolute','fixed'].includes(frame.contentWindow.getComputedStyle(selectedElement).position))return;
  commitCardForm();
  const parent = selectedElement.parentElement,siblings=orderSiblings();
  const currentIndex = siblings.indexOf(selectedElement);
  const nextIndex = Math.max(0, Math.min(siblings.length - 1, currentIndex + offset));
  if (nextIndex === currentIndex) return;
  if(!allowReorder(parent))return;
  const reference = offset < 0 ? siblings[nextIndex] : siblings[nextIndex].nextSibling;
  parent.insertBefore(selectedElement, reference);
  rememberSiblingOrder(parent);persistState();updateOrderControls();scheduleLayers();updateResizeHandle();
  showToast(offset < 0 ? '排列已提前一位，可撤销' : '排列已延后一位，可撤销');
}

frame.addEventListener('load', setupFrame);
helpToggle.addEventListener('click', () => {
  if(aiBusy)return;
  const switching=aiDialog.open;if(switching)aiDialog.close();
  setHelpOpen(switching || helpToggle.getAttribute('aria-expanded') !== 'true');
});

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  commitCardForm();
  mode = button.dataset.mode;
  editorMain.classList.toggle('editing-mode',mode==='edit');
  setPointerMode(mode==='edit'?'move':'');
  document.querySelectorAll('[data-mode]').forEach(item => item.classList.toggle('active', item === button));
  document.getElementById('mode-label').textContent = mode === 'edit' ? '编辑模式' : '预览模式';
  document.getElementById('mode-hint').textContent = mode === 'edit' ? ' · 长按左键滑动多选 · Shift 追加选择' : ' · 可直接操作页面';
  if(mode==='edit')setLayersOpen(true);
  const doc = frameDocument();
  doc.body.classList.toggle('ve-edit-mode', mode === 'edit');
  doc.body.classList.toggle('ve-preview-mode', mode !== 'edit');
  doc.body.classList.toggle('ve-pointer-move',mode==='edit' && !!pointerMode);
  prepareReorderables(doc);
  if (mode !== 'edit') clearSelection();
}));

document.querySelectorAll('[data-viewport]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-viewport]').forEach(item => item.classList.toggle('active', item === button));
  viewportName=button.dataset.viewport;
  canvasFrame.className = `canvas-frame ${viewportName}`;
  resizeCanvas();
}));

fields.text.addEventListener('change', () => {
  if (!selectedElement || fields.text.disabled) return;
  const targets=editableTextTargets(selectedElement);
  commitChanges(targets.map(({element,index},position)=>{
    const value=position===0?fields.text.value:'';
    return index===null?{element,text:value}:{element,textNodes:{[index]:value}};
  }));
});
fields.fontSize.addEventListener('change', () => updateSelectedStyle({ fontSize: fields.fontSize.value ? `${fields.fontSize.value}px` : '' }));
fields.fontWeight.addEventListener('change', () => updateSelectedStyle({ fontWeight: fields.fontWeight.value }));
fields.textAlign.addEventListener('change', () => updateSelectedStyle({ textAlign: fields.textAlign.value }));
fields.radius.addEventListener('change', () => updateSelectedStyle({ borderRadius: `${fields.radius.value || 0}px` }));
fields.opacity.addEventListener('change', () => updateSelectedStyle({ opacity: String((Number(fields.opacity.value) || 0) / 100) }));
fields.width.addEventListener('change', () => updateSelectedStyle({ width: normalizeSize(fields.width.value) }));
fields.height.addEventListener('change', () => updateSelectedStyle({ height: normalizeSize(fields.height.value) }));

function bindColor(colorField, textField, property) {
  const apply = value => {
    colorField.value = rgbToHex(value, property === 'color' ? '#17243a' : '#ffffff');
    textField.value = value;
    updateSelectedStyle({ [property]: value });
  };
  colorField.addEventListener('input', () => apply(colorField.value));
  textField.addEventListener('change', () => apply(textField.value));
}
bindColor(fields.color, fields.colorText, 'color');
bindColor(fields.background, fields.backgroundText, 'backgroundColor');

undoButton.addEventListener('click', () => {
  state = undoState(state);
  cardInputs=[];
  persistState('已撤销，正在刷新画布');
  reloadFrame();
});
redoButton.addEventListener('click', () => {
  state = redoState(state);
  cardInputs=[];
  persistState('已重做，正在刷新画布');
  reloadFrame();
});
document.getElementById('reload-button').addEventListener('click', refreshSource);
changesToggle.addEventListener('click', () => setChangesVisible(!showChanges));
boxToggle.addEventListener('click', () => {
  if (selectionLayer) { cancelBoxSelection(); return; }
  if (!showChanges) setChangesVisible(true);
  startBoxSelection();
});
document.getElementById('save-button').addEventListener('click', async event => {
  commitCardForm();await saveToSource();
});
document.getElementById('clear-selection').addEventListener('click', () => {commitCardForm();clearSelection();});
document.getElementById('move-up-button').addEventListener('click', () => moveSelected(-1));
document.getElementById('move-down-button').addEventListener('click', () => moveSelected(1));
function deleteSelection() {
  if (mode!=='edit' || !selectedElement || selectedList().some(isLocked)) return;
  cancelMovement();
  cardInputs=[];
  if(selectedList().some(element=>!allowChange(element,{deleted:true})))return;
  const previous=state;
  for(const element of selectedList()) {
    const selector=selectorFor(element);
    state=deleteElement(state,elementKey(selector),selector);
  }
  state={...state,past:[...previous.past,previous.patches],future:[]};
  applyAllPatches();persistState();clearSelection();showToast('已删除所选元素，可一次撤销恢复');
}
document.getElementById('delete-button').addEventListener('click',deleteSelection);
document.getElementById('restore-element-button').addEventListener('click', () => {
  if (!selectedElement) return;
  cardInputs=[];
  const selectors=new Set();
  for(const element of selectedList()) for(const node of [element,...element.querySelectorAll('*')]) selectors.add(selectorFor(node));
  const nextPatches=Object.fromEntries(Object.entries(state.patches).flatMap(([key,patch])=>!selectors.has(patch.selector)?[[key,patch]]:patch.insert?[[key,{selector:patch.selector,insert:patch.insert,position:patch.position}]]:[]));
  if(JSON.stringify(nextPatches)===JSON.stringify(state.patches))return;
  state={...state,patches:nextPatches,past:[...state.past,state.patches],future:[]};
  persistState('所选元素及内部内容已恢复');reloadFrame();
});

const exportMenu = document.getElementById('export-menu');
document.getElementById('export-menu-button').addEventListener('click', () => { exportMenu.hidden = !exportMenu.hidden; });
document.getElementById('export-json-button').addEventListener('click', () => {
  download('jx-dashboard-visual-edits.json', serializeEditorState(state), 'application/json;charset=utf-8');
  exportMenu.hidden = true;
  showToast('调整 JSON 已导出');
});
document.getElementById('export-html-button').addEventListener('click', async () => {
  exportMenu.hidden = true;
  try { await exportHtml(); } catch (error) { showToast(`导出失败：${error.message}`); }
});
document.getElementById('import-button').addEventListener('click', () => document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported=createEditorState(JSON.parse(await file.text()));
    if(!allowEntries(Object.entries(imported.patches))){event.target.value='';exportMenu.hidden=true;return;}
    state=imported;
    persistState('导入成功，正在刷新画布');
    reloadFrame();
    showToast('调整 JSON 已导入');
  } catch {
    showToast('导入失败：不是有效的调整文件');
  }
  event.target.value = '';
  exportMenu.hidden = true;
});
const sourceDialog=document.getElementById('source-dialog');
const sourceStatus=document.getElementById('source-dialog-status');
const sourceConflicts=document.getElementById('source-conflicts');
const sourceConfirm=document.getElementById('source-confirm');
let sourceBusy=false;
async function sourceRequest(path,body) {
  const response=await fetch(projectEndpoint(path),body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'源码操作失败');return value;
}
function rememberSource(value) {
  loadedSourceDocument=new DOMParser().parseFromString(value.source,'text/html');
  sourceBaseline={source:value.source,revision:value.revision,hashes:value.hashes,entry:value.entry};
  loadedSourceRevision=value.revision;
  localStorage.setItem(SOURCE_BASE_KEY,JSON.stringify(sourceBaseline));
}
async function initializeSourceState() {
  const current=await sourceRequest('/api/source-state');
  loadedSourceDocument=new DOMParser().parseFromString(current.source,'text/html');
  const saved=localStorage.getItem(SOURCE_BASE_KEY);
  if(saved && localStorage.getItem(DRAFT_DIRTY_KEY)==='1') {
    try{sourceBaseline=JSON.parse(saved);}catch{rememberSource(current);}
  }else rememberSource(current);
  loadedSourceRevision=current.revision;
  document.getElementById('source-change-banner').hidden=true;
}
function sourceModal(title) {
  document.getElementById('source-dialog-title').textContent=title;
  sourceConflicts.replaceChildren();sourceConfirm.hidden=true;sourceStatus.textContent='正在读取源码并检查改动…';
  if(!sourceDialog.open)sourceDialog.showModal();
}
document.getElementById('source-dialog-close').onclick=()=>{if(!sourceBusy)sourceDialog.close();};
sourceDialog.addEventListener('cancel',event=>{if(sourceBusy)event.preventDefault();});
async function saveToSource(choices={},checkedRevision=null,{autoAI=true}={}) {
  if(sourceBusy)return false;
  sourceModal('保存到源码');sourceBusy=true;
  try {
    const current=await sourceRequest('/api/source-state');
    if(!sourceBaseline)rememberSource(current);
    if(checkedRevision && current.revision!==checkedRevision)choices={};
    const routes=routePendingEdits(new DOMParser().parseFromString(current.source,'text/html'));
    const result=compileSource({base:sourceBaseline,current,patches:routes.direct,choices,projectId});
    if(result.conflicts.length) {
      sourceStatus.textContent='检测到双方修改了相同内容。请逐项选择；未冲突的代码会保留。';
      for(const item of result.conflicts) {
        const row=document.createElement('div');row.className='source-conflict';
        const title=document.createElement('strong');title.textContent=item.label;
        const content=document.createElement('pre');content.textContent=`原来：${item.before}\n代码现在：${item.code}\n编辑器：${item.editor}`;
        const select=document.createElement('select');select.dataset.conflict=item.id;
        select.append(new Option('请选择保留方式',''),new Option('保留代码修改','code'));
        if(!item.codeOnly)select.append(new Option('使用编辑器修改','editor'));
        row.append(title,content,select);sourceConflicts.append(row);
      }
      sourceConfirm.hidden=false;sourceConfirm.textContent='按以上选择保存';sourceConfirm.disabled=true;
      sourceConflicts.onchange=()=>{sourceConfirm.disabled=[...sourceConflicts.querySelectorAll('select')].some(select=>!select.value);};
      sourceConfirm.onclick=()=>saveToSource({...choices,...Object.fromEntries([...sourceConflicts.querySelectorAll('select')].map(select=>[select.dataset.conflict,select.value]))},current.revision,{autoAI});
      return false;
    }
    if (result.unsupported.length) {
      sourceStatus.textContent = `无法安全保存以下修改，草稿已保留：${result.unsupported.join('；')}`;
      return false;
    }
    sourceStatus.textContent=`正在备份并写入 ${projectEntry}…`;
    const saved=await sourceRequest('/api/source-save',{revision:current.revision,html:result.html,draft:{version:1,patches:state.patches},pending:{version:1,patches:routes.pending}});
    state=createEditorState({patches:routes.pending});
    const pendingCount=Object.keys(routes.pending).length;
    const savedPath=`${projectConfig.root}/${projectEntry}`;
    const message=pendingCount?`部分保存到 ${savedPath}；${pendingCount} 项未写入源码（AI 待办），暂不可交付`:`已写入本地文件 ${savedPath}，历史版本已备份`;
    rememberSource(saved);clearSelection();persistState(message,{dirty:false});reloadFrame();saveStatus.textContent=message;
    document.getElementById('source-change-banner').hidden=true;sourceDialog.close();showToast(Object.keys(routes.pending).length?'可直接写入的修改已保存，其余已进入 AI 待办':'已写入项目源码');
    if(autoAI && Object.keys(routes.pending).length)setTimeout(()=>openAI(true),0);
    return pendingCount===0;
  }catch(error){sourceStatus.textContent=`未完成保存：${error.message}。草稿已保留。`;return false;}
  finally{sourceBusy=false;}
}
async function refreshSource() {
  if(refreshingSource)return;
  refreshingSource=true;
  const button=document.getElementById('source-refresh');button.disabled=true;button.textContent='正在载入…';
  commitCardForm();
  try {
    const current=await sourceRequest('/api/source-state');
    loadedSourceDocument=new DOMParser().parseFromString(current.source,'text/html');
    if(localStorage.getItem(DRAFT_DIRTY_KEY)!=='1')rememberSource(current);
    loadedSourceRevision=current.revision;
    document.getElementById('source-change-banner').hidden=true;
    reloadFrame();
    showToast(localStorage.getItem(DRAFT_DIRTY_KEY)==='1'?'已载入最新代码，草稿仍保留，保存时检查冲突':'已载入最新代码');
  }catch(error){showToast(error.message);}
  finally{refreshingSource=false;button.disabled=false;button.textContent='载入最新代码';}
}
document.getElementById('source-refresh').onclick=refreshSource;
window.addEventListener('focus',checkExternalSource);
async function checkExternalSource() {
  if(!projectReady || !sourceBaseline || refreshingSource || sourceBusy || document.hidden || historyDialog.open || sourceDialog.open)return;
  try{const current=await sourceRequest('/api/source-state');if(!refreshingSource)document.getElementById('source-change-banner').hidden=current.revision===loadedSourceRevision;}catch{}
}
setInterval(checkExternalSource,5000);

const historyDialog=document.getElementById('history-dialog');
const historyStatus=document.getElementById('history-status');
const historyList=document.getElementById('history-list');
let restoringHistory=false;
let historyPreviewId=null,historyPreviewToken=0;
let historyChoice=null;
const historyPage=document.getElementById('history-preview-page');
const historyPreview=document.getElementById('history-preview');
const historyRestore=document.getElementById('history-restore');
function sizeHistoryPreview() {
  const viewport=document.getElementById('history-preview-viewport');
  const width=viewportSizes[viewportName][0],scale=Math.max(.1,viewport.clientWidth/width);
  Object.assign(historyPreview.style,{width:`${width}px`,height:`${viewport.clientHeight/scale}px`,transform:`scale(${scale})`});
}
new ResizeObserver(sizeHistoryPreview).observe(document.getElementById('history-preview-viewport'));
async function previewHistory(id,title,detail,savedAt=null,entry=projectEntry) {
  if(restoringHistory)return;
  historyChoice={id,title,detail,savedAt};
  const token=++historyPreviewToken;historyPreviewId=null;historyRestore.disabled=true;
  historyList.querySelectorAll('[data-version]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.version===id)));
  document.getElementById('history-preview-title').textContent=title;
  document.getElementById('history-preview-note').textContent='正在载入预览…';
  historyPreview.style.visibility='hidden';
  try {
    const related=entry!==projectEntry;
    const endpoint=new URL(projectEndpoint('/api/source-history'),location.href);
    if(related)endpoint.searchParams.set('entry',entry);
    if(related && id!=='original' && savedAt)endpoint.searchParams.set('at',savedAt);
    else endpoint.searchParams.set('id',related?'original':id);
    const sourceUrl=related?new URL(`/project/${projectId}/${entry.split('/').map(encodeURIComponent).join('/')}`,location.href).href:currentFrameUrl();
    historyPage.value=entry;
    const [versionResponse,sourceResponse]=await Promise.all([fetch(endpoint,{cache:'no-store'}),fetch(sourceUrl,{cache:'no-store'})]);
    const result=await versionResponse.json(),version=result.value||result;
    if(!versionResponse.ok || (!sourceResponse.ok && !version.source))throw new Error(result.error||'无法读取预览');
    const source=version.source??await sourceResponse.text();if(token!==historyPreviewToken)return;
    historyPreview.onload=()=>{
      if(token!==historyPreviewToken)return;
      try {
        sizeHistoryPreview();historyPreview.style.visibility='visible';
        historyPreviewId=id;historyRestore.disabled=false;
        historyRestore.textContent=`将 ${projectEntry} 恢复到${id==='original'?'原始页面':'所选版本'}`;
        document.getElementById('history-preview-note').textContent=detail;
        document.getElementById('history-page-note').textContent=related
          ? `${entry} · ${result.savedAt?`使用 ${new Date(result.savedAt).toLocaleString('zh-CN')} 的保存记录`:'该时点没有已保存调整，显示原始页面'}`
          : `${entry} · 所选历史版本（可操作 Tab）`;
      }catch(error){document.getElementById('history-preview-note').textContent=`预览失败：${error.message}`;}
    };
    historyPreview.srcdoc=interactiveHistorySource(source,sourceUrl,version.patches,String(token),version.assetBase);
  }catch(error){if(token===historyPreviewToken)document.getElementById('history-preview-note').textContent=`预览失败：${error.message}`;}
}
historyPage.onchange=()=>{if(historyChoice){const {id,title,detail,savedAt}=historyChoice;previewHistory(id,title,detail,savedAt,historyPage.value);}};
window.addEventListener('message',event=>{
  if(event.source!==historyPreview.contentWindow || event.origin!==location.origin || event.data?.kind!=='history-navigate' || event.data.token!==String(historyPreviewToken) || !historyChoice)return;
  const target=new URL(event.data.url),prefix=`/project/${projectId}/`;
  if(target.origin!==location.origin || !target.pathname.startsWith(prefix)){document.getElementById('history-page-note').textContent='历史预览仅支持当前项目内的页面导航';return;}
  const entry=decodeURIComponent(target.pathname.slice(prefix.length));
  if(![...historyPage.options].some(option=>option.value===entry)){document.getElementById('history-page-note').textContent='此链接不是当前项目中的 HTML 页面';return;}
  const {id,title,detail,savedAt}=historyChoice;previewHistory(id,title,detail,savedAt,entry);
});
historyRestore.onclick=()=>{if(historyPreviewId)restoreHistory(historyPreviewId);};
historyDialog.addEventListener('close',()=>{historyPreviewToken++;historyPreviewId=null;historyPreview.onload=null;historyPreview.srcdoc='';});
async function restoreHistory(id) {
  if(restoringHistory)return;
  sourceModal('恢复源码版本');
  try {
    const current=await sourceRequest('/api/source-state');
    const endpoint=new URL(projectEndpoint('/api/source-history'),location.href);endpoint.searchParams.set('id',id);
    const response=await fetch(endpoint),version=await response.json();if(!response.ok)throw new Error(version.error);
    const changed=Object.keys(version.sourceFiles).filter(path=>version.sourceFiles[path]!==current.files[path]);
    sourceStatus.textContent=`恢复将改写以下 ${changed.length} 个源码文件，并恢复该版本的编辑记录。共享 CSS/JS 的恢复也会影响其他页面的显示和交互。当前源码与草稿会先备份。`;
    for(const path of changed){const row=document.createElement('details'),label=document.createElement('summary'),content=document.createElement('pre');label.textContent=path;content.textContent=`当前内容（前 1200 字）：\n${(current.files[path]||'').slice(0,1200)}\n\n恢复后（前 1200 字）：\n${version.sourceFiles[path].slice(0,1200)}`;row.className='source-conflict';row.append(label,content);sourceConflicts.append(row);}
    sourceConfirm.hidden=false;sourceConfirm.disabled=false;sourceConfirm.textContent=`确认恢复${changed.length?` ${changed.length} 个文件`:''}`;
    sourceConfirm.onclick=async()=>{
      if(sourceBusy)return;sourceBusy=true;restoringHistory=true;sourceConfirm.disabled=true;
      try {
        const result=await sourceRequest('/api/source-history',{id,revision:current.revision,draft:{version:1,patches:state.patches}});
        state=createEditorState(result);rememberSource(result);clearSelection();persistState('源码版本已恢复',{dirty:Object.keys(result.patches).length>0});reloadFrame();
        sourceDialog.close();historyDialog.close();showToast('源码和编辑记录已恢复，之前状态已备份');
      }catch(error){sourceStatus.textContent=`未完成恢复：${error.message}。请关闭后重新选择版本。`;}
      finally{sourceBusy=false;restoringHistory=false;sourceConfirm.disabled=false;}
    };
  }catch(error){sourceStatus.textContent=`无法准备恢复：${error.message}`;}
}
function historyRow(id,title,detail,savedAt=null) {
  const row=document.createElement('div');row.className='history-row';
  const info=document.createElement('div'),label=document.createElement('strong'),hint=document.createElement('small');
  label.textContent=title;hint.textContent=detail;info.append(label,hint);
  const button=document.createElement('button');button.type='button';button.dataset.version=id;button.setAttribute('aria-pressed','false');button.append(info);button.onclick=()=>previewHistory(id,title,detail,savedAt);
  row.append(button);historyList.append(row);
}
async function openHistory() {
  if(document.getElementById('save-button').disabled){showToast('正在保存，请稍后打开历史版本');return;}
  commitCardForm();exportMenu.hidden=true;
  historyList.replaceChildren();historyStatus.textContent='正在读取当前页面的历史版本…';
  historyRestore.disabled=true;historyPreview.style.visibility='hidden';
  historyPage.replaceChildren(...(projectConfig?.pages||[projectEntry]).map(entry=>new Option(entry,entry)));
  historyDialog.showModal();
  try {
    const response=await fetch(projectEndpoint('/api/source-history'),{cache:'no-store'});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'读取失败');
    for(const [index,version] of result.versions.entries()) {
      const time=new Date(version.savedAt).toLocaleString('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
      historyRow(version.id,version.id==='current'?'最近一次保存':version.beforeRestore?'恢复前的状态':`历史保存 ${result.versions.length-index}`,`${time}\n${version.summary}`,version.savedAt);
    }
    historyRow('original','初版副本','首次记录的独立副本；日常保存只更新当前工作文件');
    historyStatus.textContent=result.versions.length?`${result.versions.length} 个版本 · 包含源码和编辑记录`:'尚无保存版本，可查看原始页面。';
    historyList.querySelector('button')?.click();
  }catch(error){historyStatus.textContent=`读取失败：${error.message}`;}
}
document.getElementById('history-button').addEventListener('click',openHistory);
document.getElementById('reset-button').addEventListener('click',openHistory);
document.getElementById('history-close').onclick=()=>historyDialog.close();
historyDialog.addEventListener('cancel',event=>{if(restoringHistory)event.preventDefault();});

document.addEventListener('click', event => {
  if (!event.target.closest('#export-menu-button') && !event.target.closest('#export-menu')) exportMenu.hidden = true;
});
document.addEventListener('keydown', event => {
  if(historyDialog.open || sourceDialog.open || document.getElementById('comparison-dialog').open)return;
  if (event.target.closest?.('input,textarea,[contenteditable="true"]')) return;
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
  event.preventDefault();
  (event.shiftKey ? redoButton : undoButton).click();
});



// Structure editing uses the same patches and history as appearance changes.
const expandedLayers = new Set();
let layerRenderTimer;
let treeDragElement = null;
const layerSearch = document.getElementById('layer-search');
const layerTree = document.getElementById('layer-tree');
const containerSelector = 'div,section,article,main,aside,header,footer,nav,ul,ol';
function isContainer(node) { return !!node?.matches(containerSelector) && !node.closest('svg,#editor-change-overlay'); }
function isLocked(node) { return !!node?.closest('[data-ve-locked]'); }
function structureAllowed(node) { return node && !node.matches('body,.cockpit-view,.drawer,svg,svg *') && !isLocked(node); }
function layerChildren(node) {
  return [...node.children].filter(child => !child.matches('script,style,template,link,svg *,#editor-change-overlay,[id^="ve-editor-"]'));
}
function setLayersOpen(open) {
  editorMain.classList.toggle('layers-open',open);
  document.getElementById('structure-panel').hidden=!open;
  document.getElementById('layers-toggle').setAttribute('aria-expanded',String(open));
  if(open) {
    setHelpOpen(false);
    const active=frameDocument()?.querySelector('.cockpit-view.active');
    for(let node=active;node && node!==frameDocument().body;node=node.parentElement)expandedLayers.add(selectorFor(node));
    renderLayers();
  }
  resizeCanvas();
}
document.getElementById('layers-toggle').addEventListener('click',()=>{
  if(aiBusy)return;
  const switching=aiDialog.open;if(switching)aiDialog.close();
  const open=switching || !editorMain.classList.contains('layers-open');
  if(open)setStructureTab('insert');
  setLayersOpen(open);
});
helpToggle.addEventListener('click',()=>{if(editorMain.classList.contains('help-open'))setLayersOpen(false);});
function setStructureTab(tab) {
  document.querySelectorAll('[data-structure-tab]').forEach(item=>item.classList.toggle('active',item.dataset.structureTab===tab));
  document.getElementById('layers-panel').hidden=tab!=='layers';
  document.getElementById('insert-panel').hidden=tab!=='insert';
}
document.querySelectorAll('[data-structure-tab]').forEach(button=>button.addEventListener('click',()=>setStructureTab(button.dataset.structureTab)));
layerSearch.addEventListener('input',()=>renderLayers());
function scheduleLayers() {
  clearTimeout(layerRenderTimer);
  layerRenderTimer=setTimeout(()=>{if(editorMain.classList.contains('layers-open'))renderLayers();},120);
}
function ensureEditMode() { if(mode!=='edit')document.querySelector('[data-mode="edit"]').click(); }
function renderLayers() {
  if(treeDragElement)return;
  const doc=frameDocument();if(!doc?.body || !doc.defaultView || !patchEngine)return;
  const query=layerSearch.value.trim().toLowerCase();
  const matches=new WeakMap();
  function includes(node) {
    if(matches.has(node))return matches.get(node);
    const value=!query || `${elementLabel(node)} ${node.id} ${node.children.length?'':node.textContent}`.toLowerCase().includes(query) || layerChildren(node).some(includes);
    matches.set(node,value);return value;
  }
  const fragment=document.createDocumentFragment();let count=0;
  function add(node,depth) {
    if(!includes(node))return;
    count++;
    const selector=selectorFor(node), children=layerChildren(node);
    const row=document.createElement('div');row.className='layer-row';row.style.paddingLeft=`${Math.min(depth,10)*12}px`;
    row.classList.toggle('selected',selectedElements.has(node));
    const patch=state.patches[elementKey(selector)];
    row.classList.toggle('concealed',!!patch?.concealed || node.hidden);
    const expanded=!!query || expandedLayers.has(selector) || (selectedElement && node!==selectedElement && node.contains(selectedElement));
    const toggle=document.createElement('button');toggle.className='layer-expander';toggle.textContent=children.length?(expanded?'⌄':'›'):'·';toggle.disabled=!children.length;
    toggle.setAttribute('aria-label',`${expanded?'折叠':'展开'} ${elementLabel(node)}`);toggle.setAttribute('aria-expanded',String(expanded));
    toggle.onclick=()=>{expandedLayers.has(selector)?expandedLayers.delete(selector):expandedLayers.add(selector);renderLayers();};
    const name=document.createElement('button');name.className='layer-name';name.textContent=elementLabel(node);name.title=`${elementLabel(node)} · ${node.tagName.toLowerCase()}${node.id?' #'+node.id:''}`;
    name.onclick=()=>{ensureEditMode();selectElement(node);if(!isLocked(node))node.scrollIntoView({block:'nearest',inline:'nearest'});};
    row.append(toggle,name);
    if(!node.matches('body,.cockpit-view')) {
      const hide=document.createElement('button');hide.className='layer-action';hide.textContent=patch?.concealed?'显':'隐';hide.title=patch?.concealed?'显示元素':'隐藏元素';hide.disabled=isLocked(node);hide.onclick=()=>toggleConcealed(node);
      const lock=document.createElement('button');lock.className='layer-action';lock.textContent=patch?.locked?'解锁':'锁';lock.title=patch?.locked?'解锁元素':'锁定元素';lock.disabled=isLocked(node.parentElement);
      lock.onclick=()=>{ensureEditMode();commitCardForm();commitElementChange(node,{locked:!patch?.locked});if(selectedElement && node.contains(selectedElement))clearSelection();renderLayers();};
      row.append(hide,lock);
    }
    row.draggable=structureAllowed(node);
    row.ondragstart=event=>{clearTimeout(layerRenderTimer);treeDragElement=node;event.dataTransfer.setData('text/plain',selector);event.dataTransfer.effectAllowed='move';};
    row.ondragover=event=>{if(treeDragElement && isContainer(node) && !isLocked(node) && !treeDragElement.contains(node)){event.preventDefault();row.classList.add('drop-target');}};
    row.ondragleave=()=>row.classList.remove('drop-target');
    row.ondrop=event=>{event.preventDefault();row.classList.remove('drop-target');if(treeDragElement)moveInto(treeDragElement,node);treeDragElement=null;};
    row.ondragend=()=>{treeDragElement=null;scheduleLayers();layerTree.querySelectorAll('.drop-target').forEach(item=>item.classList.remove('drop-target'));};
    fragment.append(row);
    if(expanded)children.forEach(child=>add(child,depth+1));
  }
  layerChildren(doc.body).forEach(node=>add(node,0));
  layerTree.replaceChildren(fragment);
  if(!count)layerTree.textContent='没有匹配的图层';
}
function toggleConcealed(node) {
  if(isLocked(node))return;
  ensureEditMode();commitCardForm();
  const patch=state.patches[elementKey(selectorFor(node))];
  commitElementChange(node,{concealed:!patch?.concealed});
  if(selectedElement)fillStructureInspector();
  renderLayers();
}
function fillStructureInspector() {
  if(!selectedElement)return;
  const single=selectedElements.size===1;
  document.getElementById('duplicate-element').disabled=!single || !structureAllowed(selectedElement);
  document.getElementById('toggle-element-visibility').disabled=!single;
  const patch=state.patches[elementKey(selectorFor(selectedElement))];
  document.getElementById('toggle-element-visibility').textContent=patch?.concealed?'显示元素':'隐藏元素';
  const rowContext=single && !isLocked(selectedElement) ? tableRowContext(selectedElement) : null;
  const columnContext=single && !isLocked(selectedElement) ? tableColumnContext(selectedElement) : null;
  document.getElementById('table-row-section').hidden=!rowContext && !selectedElement.closest('table');
  document.getElementById('add-table-row').disabled=!rowContext || isLocked(rowContext.body);
  document.getElementById('delete-table-row').disabled=!rowContext?.row || isLocked(rowContext.row);
  document.getElementById('add-table-column').disabled=!columnContext || columnContext.rows.some(isLocked);
  document.getElementById('delete-table-column').disabled=!columnContext || columnContext.selected===null || columnContext.index<=1 && columnContext.rows.every(row=>row.cells.length<=1) || columnContext.rows.some(isLocked);
  document.getElementById('table-structure-hint').textContent=selectedElement.closest('table') && !columnContext
    ? '此表含跨行合并单元格，暂不支持增删列；仍可操作普通数据行。'
    : '选中单元格后在当前行或列之后添加，或删除所在行列；选中整张表时在末尾添加。可撤销。';
}
function moveInto(node,parent) {
  if(!structureAllowed(node) || !isContainer(parent) || isLocked(parent) || node.contains(parent)) {showToast('请选择可用容器，不能移入自身或内部元素');return;}
  ensureEditMode();commitCardForm();
  if(node.parentElement===parent)return;
  // Save both complete sibling orders to avoid index collisions with earlier moves.
  const oldParent=node.parentElement;
  const oldOrder=[...oldParent.children].filter(item=>item!==node && item.tagName!=='TEMPLATE');
  const newOrder=[...parent.children].filter(item=>item.tagName!=='TEMPLATE').concat(node);
  const changes=[];
  for(const [container,order] of [[oldParent,oldOrder],[parent,newOrder]])order.forEach((element,index)=>changes.push({element,position:{parent:selectorFor(container),index}}));
  if(!commitChanges(changes))return;
  expandedLayers.add(selectorFor(parent));selectElement(node);showToast('已移入目标容器，可撤销');
}
document.getElementById('toggle-element-visibility').onclick=()=>{if(selectedElement)toggleConcealed(selectedElement);};
document.getElementById('add-table-row').onclick=()=>{
  if(mode!=='edit' || selectedElements.size!==1)return;
  const context=tableRowContext(selectedElement);
  if(!context || isLocked(context.body) || isLocked(context.template))return;
  commitCardForm();
  if(!insertSnapshot(prepareSnapshot(blankTableRow(context.template)),context.body,context.index))return;
  showToast('已添加空白行，可撤销');
};
document.getElementById('delete-table-row').onclick=()=>{
  if(mode!=='edit' || selectedElements.size!==1)return;
  const context=tableRowContext(selectedElement);
  if(!context?.row || isLocked(context.row))return;
  commitCardForm();
  const selector=selectorFor(context.row);
  if(!allowChange(context.row,{deleted:true}))return;
  state=deleteElement(state,elementKey(selector),selector);
  applyAllPatches();persistState();clearSelection();
  showToast('已删除表格行，可撤销');
};
document.getElementById('add-table-column').onclick=()=>{
  if(mode!=='edit' || selectedElements.size!==1)return;
  const context=tableColumnContext(selectedElement);
  if(!context || context.rows.some(isLocked))return;
  commitCardForm();
  const items=[],spanChanges=[];
  for(const row of context.rows) {
    const target=columnInsertTarget(row,context.index);
    if(target.spanCell) {
      const selector=selectorFor(target.spanCell);
      spanChanges.push([elementKey(selector),{selector,attributes:{colspan:String(target.spanCell.colSpan+1)}}]);
    } else if(target.source)items.push({copy:prepareSnapshot(blankTableCell(target.source)),parent:row,index:target.index});
  }
  if(!insertSnapshots(items,spanChanges))return;
  showToast('已添加空白列，可撤销');
};
document.getElementById('delete-table-column').onclick=()=>{
  if(mode!=='edit' || selectedElements.size!==1)return;
  const context=tableColumnContext(selectedElement);
  if(!context || context.selected===null || context.rows.some(isLocked))return;
  commitCardForm();
  const entries=context.rows.flatMap(row=>{
    const target=columnDeleteTarget(row,context.selected);
    if(!target)return [];
    const node=target.cell || target.spanCell,selector=selectorFor(node);
    return [[elementKey(selector),target.spanCell
      ? {selector,attributes:{colspan:String(node.colSpan-1)}}
      : {selector,deleted:true}]];
  });
  if(!allowEntries(entries))return false;
  state=batchElementChanges(state,entries);
  applyAllPatches();persistState();clearSelection();
  showToast('已删除表格列，可撤销');
};

function prepareSnapshot(element) {
  const copy=element.cloneNode(true), prefix=`ve-added-${crypto.randomUUID()}`;
  const ids=new Map();
  const nodes=[copy,...copy.querySelectorAll('*')];
  nodes.forEach((node,index)=>{
    if(node.id) {ids.set(node.id,`${prefix}-${index}`);node.id=`${prefix}-${index}`;}
    for(const attr of [...node.attributes])if(attr.name.startsWith('data-ve-') || /^on/i.test(attr.name) || ['draggable','contenteditable','autofocus'].includes(attr.name))node.removeAttribute(attr.name);
    [...node.classList].filter(name=>name.startsWith('ve-')).forEach(name=>node.classList.remove(name));
    node.dataset.veNode=`${prefix}-${index}`;
  });
  for(const node of nodes)for(const attr of ['for','aria-labelledby','aria-describedby','aria-controls','href'])if(node.hasAttribute(attr)) {
    node.setAttribute(attr,node.getAttribute(attr).split(' ').map(value=>value.startsWith('#')?(ids.has(value.slice(1))?'#'+ids.get(value.slice(1)):value):(ids.get(value)||value)).join(' '));
  }
  copy.querySelectorAll('script,style,iframe,object,embed,#editor-change-overlay').forEach(node=>node.remove());
  return copy;
}
function insertSnapshots(items,extraEntries=[]) {
  const entries=[...extraEntries];
  for(const {copy,parent,index} of items) {
    const selector=`[data-ve-node="${copy.dataset.veNode}"]`;
    const parentSelector=selectorFor(parent);
    entries.push([elementKey(selector),{selector,insert:{parent:parentSelector,html:copy.outerHTML},position:{parent:parentSelector,index}}]);
    [...parent.children].filter(node=>node.tagName!=='TEMPLATE').forEach((node,position)=>{
      const key=selectorFor(node);
      entries.push([elementKey(key),{selector:key,position:{parent:parentSelector,index:position>=index?position+1:position}}]);
    });
  }
  if(!allowEntries(entries))return false;
  state=batchElementChanges(state,entries);applyAllPatches();persistState();prepareReorderables(frameDocument());
  const last=items.at(-1);
  const inserted=last && patchEngine.resolve(`[data-ve-node="${last.copy.dataset.veNode}"]`);
  for(const {parent} of items)expandedLayers.add(selectorFor(parent));
  if(inserted)selectElement(inserted);
  return true;
}
function insertSnapshot(copy,parent,index) {
  return insertSnapshots([{copy,parent,index}]);
}
let componentClipboard=null;
function copyComponent() {
  if(selectedElements.size!==1 || !structureAllowed(selectedElement))return;
  commitCardForm();
  componentClipboard={html:prepareSnapshot(selectedElement).outerHTML,parent:selectorFor(selectedElement.parentElement),source:selectorFor(selectedElement)};
  showToast('组件已复制，按 ⌘V / Ctrl+V 粘贴副本');
}
function pasteComponent() {
  if(!componentClipboard || mode!=='edit')return;
  const parent=patchEngine.resolve(componentClipboard.parent);
  if(!parent?.isConnected || isLocked(parent)){showToast('原容器已不存在或被锁定，请重新复制组件');return;}
  commitCardForm();
  const template=frameDocument().createElement('template');template.innerHTML=componentClipboard.html;
  const copy=prepareSnapshot(template.content.firstElementChild);
  const siblings=[...parent.children].filter(item=>item.tagName!=='TEMPLATE');
  const source=patchEngine.resolve(componentClipboard.source);
  const anchor=selectedElement?.parentElement===parent?selectedElement:source;
  const index=siblings.indexOf(anchor);
  if(!insertSnapshot(copy,parent,index<0?siblings.length:index+1))return;
  showToast('已粘贴组件副本，可拖动调整位置');
}
document.getElementById('duplicate-element').onclick=()=>{
  if(selectedElements.size!==1 || !structureAllowed(selectedElement))return;
  commitCardForm();ensureEditMode();
  const node=selectedElement,parent=node.parentElement;
  if(!insertSnapshot(prepareSnapshot(node),parent,[...parent.children].filter(item=>item.tagName!=='TEMPLATE').indexOf(node)+1))return;
  showToast('已复制，可独立修改文字与布局');
};
const componentTemplates={
  card:'<div class="ha-metric" style="min-width:0;padding:18px;background:#fff;border:1px solid #dce4ed;border-radius:12px"><div class="ha-metric-top">新增指标</div><div class="ha-metric-main"><strong>128<small> 人</small></strong></div><em>演示数据</em></div>',
  container:'<div style="min-height:100px;padding:16px;border:1px dashed #a6bad1;border-radius:10px;display:grid;gap:12px"><p style="margin:0;color:#758296">新容器 · 演示数据</p></div>',
  heading:'<h3 style="margin:0;font-size:18px;color:#17243a">标题</h3>',
  text:'<p style="margin:0;font-size:14px;line-height:1.6;color:#52647a">文字</p>',
  button:'<button type="button" style="padding:10px 18px;border:0;border-radius:6px;background:#2468d8;color:#fff">演示按钮</button>',
  circle:'<div aria-label="圆形" style="height:160px;border-radius:50%;background:#dbeafe;border:1px solid #93b4ed"></div>',
  rectangle:'<div aria-label="矩形" style="height:140px;background:#dbeafe;border:1px solid #93b4ed"></div>',
  divider:'<hr style="width:100%;margin:12px 0;border:0;border-top:1px solid #dce4ed" />'
};
let paletteType=null;
let paletteTarget=null;
function clearPaletteTarget() {
  paletteTarget?.classList.remove('ve-drop-target');paletteTarget=null;
}
function paletteContainer(event) {
  let node=event.target;
  while(node && node!==frameDocument().body) {
    if(isLocked(node))return null;
    if(isContainer(node) && node.getBoundingClientRect().width && node.getBoundingClientRect().height)return node;
    node=node.parentElement;
  }
  return frameDocument().body;
}
function handlePaletteOver(event) {
  if(mode!=='edit')return;
  clearPaletteTarget();
  const parent=paletteContainer(event);
  if(!parent || isLocked(parent))return;
  event.preventDefault();event.stopImmediatePropagation();event.dataTransfer.dropEffect='copy';
  paletteTarget=parent;parent.classList.add('ve-drop-target');
}
function addPlacedComponent(type,parent,x,y,imageData=null) {
  commitCardForm();ensureEditMode();
  const doc=frameDocument();
  const parentStatus=saveabilityChecker()?.target(selectorFor(parent));
  if(!parentStatus){showToast('尚未读取源码');return;}
  const template=doc.createElement('template');template.innerHTML=type==='image'?'<img alt="本地图片" style="height:auto;object-fit:contain;display:block" />':componentTemplates[type];
  if(imageData) {template.content.firstElementChild.src=imageData.url;template.content.firstElementChild.alt=imageData.name;}
  const copy=prepareSnapshot(template.content.firstElementChild);
  const width={card:240,container:280,heading:240,text:280,button:130,divider:240,circle:160,rectangle:240,image:Math.min(320,imageData?.width||320)}[type];
  Object.assign(copy.style,{position:'absolute',width:['heading','text'].includes(type)?'80px':`${width}px`,boxSizing:'border-box',margin:'0',zIndex:'1'});
  // Use the existing containing block without changing the container's styles.
  // Making a static container relative would relocate its existing absolute children.
  parent.append(copy);
  const block=copy.offsetParent;
  const initial=!block || (block===doc.body && doc.defaultView.getComputedStyle(block).position==='static');
  const rect=initial?{left:0,top:0}:block.getBoundingClientRect();
  const left=x-rect.left-(initial?0:block.clientLeft)+(initial?doc.defaultView.scrollX:block.scrollLeft);
  const top=y-rect.top-(initial?0:block.clientTop)+(initial?doc.defaultView.scrollY:block.scrollTop);
  copy.remove();
  Object.assign(copy.style,{left:`${Math.round(left)}px`,top:`${Math.round(top)}px`});
  if(!insertSnapshot(copy,parent,[...parent.children].filter(node=>node.tagName!=='TEMPLATE').length))return;
  setPointerMode('move');showToast('已放置组件，可拖动微调或撤销');
}
function handlePaletteDrop(event) {
  const parent=paletteContainer(event),type=paletteType;
  clearPaletteTarget();paletteType=null;
  if(mode!=='edit' || !parent || isLocked(parent))return;
  event.preventDefault();event.stopImmediatePropagation();
  addPlacedComponent(type,parent,event.clientX,event.clientY);
}
document.querySelectorAll('[data-insert]').forEach(button=>{
  button.draggable=button.dataset.insert!=='image';
  button.addEventListener('dragstart',event=>{
    ensureEditMode();paletteType=button.dataset.insert;
    event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('text/plain',`component:${paletteType}`);
  });
  button.addEventListener('dragend',()=>{paletteType=null;clearPaletteTarget();});
  button.onclick=()=>{
    ensureEditMode();
    const parent=isContainer(selectedElement)?selectedElement:selectedElement?.parentElement || frameDocument().body;
    if(!parent || isLocked(parent)){showToast('请先解锁目标容器');return;}
    const rect=parent.getBoundingClientRect();
    const x=Math.max(0,rect.left)+24,y=Math.max(0,rect.top)+24;
    if(button.dataset.insert==='image') {
      imagePlacement={parent,x,y};imagePicker.value='';imagePicker.click();return;
    }
    addPlacedComponent(button.dataset.insert,parent,x,y);
  };
});

let imagePlacement=null;
const imagePicker=document.createElement('input');
imagePicker.type='file';imagePicker.accept='image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
imagePicker.hidden=true;imagePicker.setAttribute('aria-label','选择本地图片');
document.body.append(imagePicker);
async function readLocalImage(file) {
  const url=URL.createObjectURL(file),image=new Image();
  try {
    image.src=url;await image.decode();
    if(!image.naturalWidth || !image.naturalHeight)throw new Error('图片尺寸无效');
    const original=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('无法读取图片'));reader.readAsDataURL(file);
    });
    // Keep small raster files unchanged, and embed larger files as compact WebP.
    // Embedded pixels travel with saved edits and offline HTML exports.
    if(/^data:image\/(png|jpeg|webp|gif);base64,/i.test(original) && original.length<180000)return {url:original,width:image.naturalWidth,name:file.name};
    const canvas=document.createElement('canvas');
    let scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    for(let attempt=0;attempt<10;attempt++) {
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL('image/webp',.85);
      if(data.length<180000)return {url:data,width:canvas.width,name:file.name};
      scale*=.75;
    }
    throw new Error('图片过大，请选择较小的图片');
  } finally {URL.revokeObjectURL(url);}
}
imagePicker.addEventListener('change',async()=>{
  const file=imagePicker.files[0],placement=imagePlacement;imagePlacement=null;
  if(!file || !placement)return;
  try {
    const data=await readLocalImage(file);
    if(mode!=='edit' || !placement.parent.isConnected || isLocked(placement.parent)) {showToast('目标容器已改变，请重新选择图片');return;}
    addPlacedComponent('image',placement.parent,placement.x,placement.y,data);
    showToast('图片已添加，可拖动位置或调整尺寸');
  } catch(error) {showToast(`无法添加图片：${error.message}`);}
});
// Resize is one undoable edit; iframe display scaling never changes design units.
let resizeGesture = null;
function updateResizeHandle() {
  updateTextToolbar();
  const handle=document.getElementById('element-resize-handle');
  if(!handle)return;
  handle.hidden=true;
  if(mode!=='edit' || !selectedElement?.isConnected || selectedElements.size!==1 || isLocked(selectedElement))return;
  const bounds=selectedElement.getBoundingClientRect(), frameBounds=frame.getBoundingClientRect();
  const scale=frameBounds.width/frame.clientWidth;
  const x=frameBounds.left+bounds.right*scale,y=frameBounds.top+bounds.bottom*scale;
  const scrollBounds=canvasScroll.getBoundingClientRect();
  if(!bounds.width || !bounds.height || x<Math.max(frameBounds.left,scrollBounds.left)+10 || x>Math.min(frameBounds.right,scrollBounds.right)-4 || y<Math.max(frameBounds.top,scrollBounds.top)+10 || y>Math.min(frameBounds.bottom,scrollBounds.bottom)-4)return;
  handle.style.left=`${x-9}px`;handle.style.top=`${y-9}px`;handle.hidden=false;
}
function finishResize(commit) {
  if(!resizeGesture)return;
  const gesture=resizeGesture;resizeGesture=null;
  const styles={width:gesture.element.style.width,height:gesture.element.style.height};
  Object.assign(gesture.element.style,gesture.before);
  if(commit) {commitChanges([{element:gesture.element,styles}]);fillInspector(gesture.element);showToast('尺寸已调整，可撤销');}
  updateResizeHandle();
}
const resizeHandle=document.getElementById('element-resize-handle');
resizeHandle.addEventListener('pointerdown',event=>{
  if(!selectedElement || isLocked(selectedElement))return;
  if(!allowChange(selectedElement))return;
  commitCardForm();cancelMovement();
  const style=frame.contentWindow.getComputedStyle(selectedElement),rect=selectedElement.getBoundingClientRect();
  resizeGesture={element:selectedElement,x:event.clientX,y:event.clientY,scale:frame.getBoundingClientRect().width/frame.clientWidth,width:parseFloat(style.width)||rect.width,height:parseFloat(style.height)||rect.height,before:{width:selectedElement.style.width,height:selectedElement.style.height}};
  resizeHandle.setPointerCapture(event.pointerId);event.preventDefault();
});
resizeHandle.addEventListener('pointermove',event=>{
  if(!resizeGesture)return;
  const g=resizeGesture;
  g.element.style.width=`${Math.max(16,Math.round(g.width+(event.clientX-g.x)/g.scale))}px`;
  g.element.style.height=`${Math.max(16,Math.round(g.height+(event.clientY-g.y)/g.scale))}px`;
  updateResizeHandle();
});
resizeHandle.addEventListener('pointerup',()=>finishResize(true));
resizeHandle.addEventListener('pointercancel',()=>finishResize(false));
document.addEventListener('keydown',event=>{if(event.key==='Escape')finishResize(false);});
canvasScroll.addEventListener('scroll',updateResizeHandle);
canvasArea.addEventListener('click',event=>{
  if(mode!=='edit' || event.target.closest('button,input,select,textarea,a,[contenteditable="true"]'))return;
  const background=[canvasArea,canvasScroll,canvasStage,frame.parentElement].includes(event.target)
    || event.target.closest('.canvas-status,.canvas-controls');
  if(!background)return;
  commitCardForm();clearSelection();
});



function showProjectError(message) {
  const banner=document.getElementById('project-error');banner.textContent=message;banner.hidden=false;
}
function currentFrameUrl() {
  const url=new URL(projectConfig.url,location.href);url.searchParams.set('visual-editor','1');
  url.hash=editorQuery.get('view') || (projectId==='builtin'?'human-admin':'');
  return url.href;
}
async function readProjectApi(path,options) {
  const response=await fetch(path,options),body=await response.json();
  if(!response.ok)throw new Error(body.error || '无法读取项目');
  return body;
}
async function switchProjectPage(id,entry,hash='') {
  commitCardForm();
  // Draft keys are immutable for this document, so a late save cannot reach another page.
  if(projectReady)persistState(undefined,{dirty:localStorage.getItem(DRAFT_DIRTY_KEY)==='1'});
  await annotationSaveQueue;
  localStorage.setItem(`html-editor-last-page:${id}`,entry);
  const url=new URL('/editor/editor.html',location.href);
  if(id!=='builtin') {url.searchParams.set('project',id);url.searchParams.set('entry',entry);}
  if(hash)url.searchParams.set('view',hash.replace(/^#/,''));
  location.assign(url.href);
}
const projectDialog=document.getElementById('project-dialog');
document.getElementById('open-project-button').onclick=()=>{document.getElementById('project-open-status').textContent='';projectDialog.showModal();};
document.getElementById('close-project-dialog').onclick=()=>projectDialog.close();
async function openProjectFolder(native=false) {
  const status=document.getElementById('project-open-status'),buttons=projectDialog.querySelectorAll('button');
  buttons.forEach(button=>button.disabled=true);status.textContent=native?'请在系统窗口中选择文件夹…':'正在读取项目中的 HTML 页面…';
  try {
    const project=await readProjectApi(native?'/api/projects/choose':'/api/projects/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(native?{}:{path:document.getElementById('project-folder-path').value})});
    if(project.cancelled){status.textContent='已取消选择';return;}
    await switchProjectPage(project.id,project.entry);
  } catch(error) {status.textContent=error.message;}
  finally {buttons.forEach(button=>button.disabled=false);}
}
document.getElementById('open-project-form').onsubmit=event=>{event.preventDefault();openProjectFolder();};
document.getElementById('choose-project-folder').onclick=()=>openProjectFolder(true);
document.getElementById('project-select').onchange=async event=>{
  try {
    const id=event.target.value;
    let descriptor=await readProjectApi(`/api/projects/current?${new URLSearchParams({project:id})}`);
    const last=localStorage.getItem(`html-editor-last-page:${id}`);
    await switchProjectPage(id,descriptor.pages.includes(last)?last:descriptor.entry);
  } catch(error){event.target.value=projectId;showProjectError(error.message);}
};
document.getElementById('remove-project-button').onclick=async event=>{
  if(projectId==='builtin' || !projectConfig)return;
  if(!confirm(`从编辑器列表移除「${projectConfig.name}」？\n原文件夹及其中的文件会保留。`))return;
  const button=event.currentTarget;
  button.disabled=true;
  try {
    commitCardForm();
    if(projectReady)persistState(undefined,{dirty:localStorage.getItem(DRAFT_DIRTY_KEY)==='1'});
    await annotationSaveQueue;
    await readProjectApi('/api/projects/remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:projectId})});
    const remaining=await readProjectApi('/api/projects');
    const next=remaining[0];
    if(next) {
      const descriptor=await readProjectApi(`/api/projects/current?${new URLSearchParams({project:next.id})}`);
      await switchProjectPage(next.id,descriptor.entry);
    } else location.assign('/editor/editor.html');
  } catch(error) {button.disabled=false;showProjectError(error.message);}
};
document.getElementById('page-select').onchange=event=>switchProjectPage(projectId,event.target.value);
async function initializeProjectContext() {
  try {
    const projects=await readProjectApi('/api/projects');
    if(projectId==='builtin' && !projects.some(project=>project.id==='builtin')) {
      if(projects.length) {
        const recent=await readProjectApi(`/api/projects/current?${new URLSearchParams({project:projects[0].id})}`);
        await switchProjectPage(recent.id,recent.entry);return false;
      }
      document.getElementById('project-select').replaceChildren(new Option('未打开项目',''));
      document.getElementById('page-select').replaceChildren(new Option('请选择 HTML',''));
      projectDialog.showModal();
      throw new Error('欢迎使用，请打开一个 HTML 项目文件夹');
    }
    const current=await readProjectApi(`/api/projects/current?${projectParams}`);
    if(projectId!=='builtin' && !projectEntry){await switchProjectPage(projectId,current.entry);return false;}
    projectConfig=current;
    document.title=`${current.entry} · HTML 可视化编辑器`;
    const projectsSelect=document.getElementById('project-select');projectsSelect.replaceChildren(...projects.map(project=>new Option(project.name,project.id)));
    projectsSelect.value=projectId;
    document.getElementById('remove-project-button').disabled=projectId==='builtin';
    const pages=document.getElementById('page-select');pages.replaceChildren(...current.pages.map(entry=>new Option(entry,entry)));pages.value=current.entry;
    const path=document.getElementById('project-path');path.textContent=current.root;path.title=current.root;
    document.getElementById('export-html-button').textContent=projectId==='builtin'?'保存并导出可运行 HTML':'保存并导出开发源码 ZIP';
    return true;
  } catch(error) {
    showProjectError(error.message.includes('欢迎使用') ? error.message : `${error.message}。请重新打开项目文件夹；若刚更新编辑器，请重启本地服务。`);
    document.querySelectorAll('[data-mode],#save-button,#reload-button,#export-menu-button').forEach(button=>button.disabled=true);
    return false;
  }
}
if(await initializeProjectContext()) {
  await Promise.all([initializeProjectState(),loadAnnotations()]);
  try{await initializeSourceState();}catch(error){showProjectError(`无法读取源码基线：${error.message}`);}
  projectReady=true;
  frame.src=currentFrameUrl();
  updateHistoryButtons();
}

installVersionComparison({projectId,projectEntry,getPages:()=>projectConfig?.pages||[projectEntry],getCurrent:()=>({patches:state.patches}),commit:commitCardForm,getWidth:()=>viewportSizes[viewportName][0]});


function routePendingEdits(currentDocument=null) {
  const checker=saveabilityChecker(),currentChecker=currentDocument && createSaveabilityChecker(currentDocument,state.patches,frameDocument(),state.patches);
  if(checker)for(const patch of Object.values(state.patches))if('text' in patch){
    const binding=checker.templateBinding(patch.selector);
    if(binding){
      patch.templateText=binding;
      if(patch.ai?.fields){delete patch.ai.fields.text;if(!Object.keys(patch.ai.fields).length)delete patch.ai;}
    }
  }
  const routes=splitEditRoutes(state.patches,patch=>checker?.check(patch)||currentChecker?.check(patch)||null,(selector,pending)=>selector && Object.values(pending).some(p=>p.insert && (p.selector===selector || frameDocument()?.querySelector(p.selector)?.contains(frameDocument()?.querySelector(selector)))));
  for(const [key,patch] of Object.entries(routes.pending)) {
    const element=frameDocument()?.querySelector(patch.selector);
    if(!Object.keys(patch.ai.context).length)patch.ai.context={path:patch.selector,label:element?elementLabel(element):patch.selector,html:element?.outerHTML.slice(0,15000)||''};
    state.patches[key]={...state.patches[key],ai:patch.ai};
  }
  renderPendingHints(Object.keys(routes.pending).length);
  return routes;
}
const aiDialog=document.getElementById('ai-dialog'),aiStatus=document.getElementById('ai-status');
let aiProposal=null,aiFingerprint='',aiBusy=false,aiRequest='';
const aiChatInput=document.getElementById('ai-chat-input'),aiChatSend=document.getElementById('ai-chat-send');
const aiChat=createAIChat({input:aiChatInput,log:document.getElementById('ai-chat-log'),storageKey:`${STORAGE_KEY}-ai-chat`});
const aiAttachments=createAIAttachments({
  getSelected:selectedList,getDocument:frameDocument,
  contextFor(element){
    const copy=element.cloneNode(true);for(const node of [copy,...copy.querySelectorAll('*')]){for(const name of ['data-ve-selector','data-ve-parent-selector','data-ve-reorderable','draggable','contenteditable'])node.removeAttribute(name);for(const name of [...node.classList])if(name.startsWith('ve-'))node.classList.remove(name);}
    const rect=element.getBoundingClientRect();return {selector:selectorFor(element),label:elementLabel(element).slice(0,300),html:copy.outerHTML.slice(0,6000),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
  },
  onChange(){updateAIChatControls();if(aiProposal){aiStatus.textContent='截图或选区已变化，请重新生成并验证。';}},
  onError(message){aiStatus.textContent=message;},
  onRegionStart(){cancelMovement();cancelBoxSelection();clearHover();showToast('在画布中拖动框选目标区域，按 Esc 取消');},
});
frame.addEventListener('load',()=>aiAttachments.cancelRegion());
function pendingFingerprint(){return JSON.stringify([state.patches,aiChat.value(),aiAttachments.fingerprint()]);}
function updateAIChatControls(){aiChatSend.disabled=aiBusy || aiAttachments.reading() || !aiChat.value() || !projectReady;}
aiChatInput.addEventListener('input',()=>{updateAIChatControls();if(aiProposal){aiStatus.textContent='修改要求已变化，请重新生成并验证。';}});
aiChatSend.onclick=()=>generateAI();
aiChatInput.addEventListener('keydown',event=>{if(event.key==='Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing){event.preventDefault();if(!aiChatSend.disabled)void generateAI();}});
aiDialog.addEventListener('cancel',event=>{if(aiBusy)event.preventDefault();});
aiDialog.addEventListener('close',()=>{aiAttachments.cancelRegion();editorMain.classList.remove('ai-open');document.getElementById('ai-chat-button').setAttribute('aria-expanded','false');resizeCanvas();updateTextToolbar();});
updateAIChatControls();
async function openAI(auto=false) {
  editorMain.classList.add('ai-open');
  document.getElementById('ai-chat-button').setAttribute('aria-expanded','true');
  if(!aiDialog.open)aiDialog.show();
  resizeCanvas();updateTextToolbar();
  const pending=routePendingEdits().pending,list=document.getElementById('ai-pending');list.replaceChildren();
  const count=Object.keys(pending).length;document.getElementById('ai-pending-count').textContent=count;document.getElementById('ai-empty').hidden=!!count;document.getElementById('ai-queue').open=!!count;document.getElementById('ai-generate').disabled=aiBusy || !count;updateAIChatControls();
  for(const patch of Object.values(pending)) {const row=document.createElement('p');row.textContent=(patch.ai.context.label||patch.selector)+'：'+Object.values(patch.ai.fields).join('；');const details=document.createElement('details'),title=document.createElement('summary'),values=document.createElement('pre');title.textContent='查看修改要求';values.textContent=JSON.stringify(Object.fromEntries(Object.entries(patch).filter(([name])=>!['ai','selector'].includes(name))),null,2);details.append(title,values);list.append(row,details);}
  try{
    const settings=await sourceRequest('/api/ai/settings');
    for(const [id,key] of [['ai-endpoint','endpoint'],['ai-model','model'],['ai-key-env','apiKeyEnv']])document.getElementById(id).value=settings[key]||'';
    document.getElementById('ai-api-key').value='';document.getElementById('ai-api-key').placeholder=settings.hasAPIKey?'密钥已保存，留空继续使用':'填写供应商提供的 API Key';
    document.getElementById('ai-http-note').hidden=!document.getElementById('ai-endpoint').value.startsWith('http:');
    document.getElementById('ai-settings').open=!settings.ready;
    const connection=document.getElementById('ai-connection');connection.textContent=settings.ready?'已配置':settings.configured?'待设置密钥':'未配置';connection.dataset.ready=String(settings.ready);
    aiStatus.textContent=Object.keys(pending).length?settings.ready?(localStorage.getItem(DRAFT_DIRTY_KEY)==='1'?'修改已进入待办，生成前会先保存项目。':'待办已保存，可以生成源码修改。'):'请先配置模型接口和 API 密钥。':'自动备份并保存 · 完成后刷新画布';
    if(settings.ready)loadAIModels();
    if(auto && settings.ready)await generateAI('');
  }catch(error){aiStatus.textContent=error.message;}
}
document.getElementById('ai-button').onclick=()=>openAI();
document.getElementById('ai-chat-button').onclick=async()=>{await openAI();aiChatInput.focus();};
document.getElementById('ai-close').onclick=()=>{if(!aiBusy)aiDialog.close();};
document.getElementById('ai-settings-save').onclick=async()=>{
  try{const value=await sourceRequest('/api/ai/settings',{endpoint:document.getElementById('ai-endpoint').value,model:document.getElementById('ai-model').value,apiKeyEnv:document.getElementById('ai-key-env').value,apiKey:document.getElementById('ai-api-key').value});document.getElementById('ai-key-env').value=value.apiKeyEnv||'';if(value.hasAPIKey){document.getElementById('ai-api-key').value='';document.getElementById('ai-api-key').placeholder='密钥已保存，留空继续使用';}const connection=document.getElementById('ai-connection');connection.textContent=value.ready?'已配置':'待设置密钥';connection.dataset.ready=String(value.ready);aiStatus.textContent=value.ready?'接口设置已保存。':'设置已保存；请设置密钥环境变量并重启服务。';}catch(error){aiStatus.textContent=error.message;}
};
async function generateAI(request=aiChat.value()) {
  if(aiBusy || aiAttachments.reading() || !projectReady)return;
  const attachments=request?aiAttachments.payload():{images:[],selection:null};
  commitCardForm();
  if(localStorage.getItem(DRAFT_DIRTY_KEY)==='1'){
    aiStatus.textContent='正在保存普通修改并保留 AI 待办…';
    await saveToSource({},null,{autoAI:false});
    if(localStorage.getItem(DRAFT_DIRTY_KEY)==='1'){aiStatus.textContent='普通修改尚未保存，请处理保存冲突或错误后重试。';return;}
  }
  aiBusy=true;aiProposal=null;aiRequest=request;aiFingerprint=pendingFingerprint();
  const history=aiChat.history();if(request)aiChat.add('user',request+(attachments.selection?'\n引用区域：'+(attachments.selection.elements.map(item=>item.label).join('、')||'框选区域'):'')+(attachments.images.length?'\n截图：'+attachments.images.map(image=>image.name).join('、'):''));
  aiChatInput.disabled=true;aiAttachments.setBusy(true);document.getElementById('ai-close').disabled=true;updateAIChatControls();
  const button=document.getElementById('ai-generate');button.disabled=true;aiStatus.textContent='模型正在修改最新源码…';
  let baselineFrame=null,previewFrame=null;
  try {
    const proposal=await sourceRequest('/api/ai/generate',{request,history:request?history:[],...attachments});
    if(aiFingerprint!==pendingFingerprint())throw new Error('生成期间草稿发生变化，请保存后重新生成');
    aiProposal=proposal;document.getElementById('ai-results').hidden=false;
    const diff=document.getElementById('ai-diff');diff.replaceChildren();
    for(const change of proposal.changes){const details=document.createElement('details'),title=document.createElement('summary'),before=document.createElement('pre'),after=document.createElement('pre');title.textContent=change.path+' · 查看修改前后';before.textContent='修改前\n'+change.before;after.textContent='修改后\n'+change.after;details.append(title,before,after);diff.append(details);}
    aiStatus.textContent='正在检查修改后的页面效果…';
    const preview=document.createElement('iframe');previewFrame=preview;preview.dataset.aiVerification='true';preview.setAttribute('aria-hidden','true');preview.tabIndex=-1;
    Object.assign(preview.style,{position:'fixed',left:'-20000px',top:'0',width:`${frame.clientWidth}px`,height:`${frame.clientHeight}px`,border:'0',pointerEvents:'none'});
    if(!proposal.baselineUrl)throw new Error('服务未提供原页面验证基线，请重启编辑器服务后重试');
    baselineFrame=document.createElement('iframe');baselineFrame.dataset.aiBaseline='true';baselineFrame.setAttribute('aria-hidden','true');baselineFrame.tabIndex=-1;
    Object.assign(baselineFrame.style,{position:'fixed',left:'-10000px',top:'0',width:`${frame.clientWidth}px`,height:`${frame.clientHeight}px`,border:'0',pointerEvents:'none'});
    await Promise.all([loadAIFrame(preview,proposal.previewUrl,document.body),loadAIFrame(baselineFrame,proposal.baselineUrl,document.body)]);
    let failures=[],stable=0;
    for(let attempt=0;attempt<20;attempt++){await new Promise(resolve=>setTimeout(resolve,250));failures=await verifyAIPage(preview.contentDocument,proposal.pending);stable=failures.length?0:stable+1;if(stable>=4)break;}
    if(stable<4 && !failures.length)failures.push('修改后的页面效果尚未稳定，请重试');
    const previewErrors=preview.contentWindow.__veAIErrors,baselineErrors=baselineFrame.contentWindow.__veAIErrors;
    if(!Array.isArray(previewErrors) || !Array.isArray(baselineErrors))throw new Error('无法读取预览或原页面的错误基线，请重新生成');
    const errorChanges=compareAIErrors(previewErrors,baselineErrors);
    for(const error of errorChanges.introduced.slice(0,5))failures.push('新增脚本或资源错误：'+(typeof error==='string'?error:error.message+(error.url?`（${error.url}）`:'')));
    const duplicateCounts=doc=>{const counts=new Map();for(const element of doc.querySelectorAll('[id]'))if(element.id)counts.set(element.id,(counts.get(element.id)||0)+1);return counts;};
    const oldIds=duplicateCounts(baselineFrame.contentDocument);
    for(const [id,count] of duplicateCounts(preview.contentDocument))if(count>1 && count>(oldIds.get(id)||0))failures.push('新增重复 ID：'+id);
    if(failures.length)throw new Error('页面效果未通过验证：'+failures.join('；'));
    aiStatus.textContent='正在保存修改并刷新主界面…';
    await applyAIProposal();
    if(errorChanges.inherited.length)aiStatus.textContent+=`原页面已有 ${errorChanges.inherited.length} 项脚本或资源问题，本次未增加。`;
  }catch(error){aiStatus.textContent=error.message+'。已保存的修改不受影响，修改要求与 AI 待办仍保留。';if(request)aiChat.add('assistant','生成失败，未写入：'+error.message);}
  finally{baselineFrame?.remove();previewFrame?.remove();aiBusy=false;aiChatInput.disabled=false;aiAttachments.setBusy(false);document.getElementById('ai-close').disabled=false;button.disabled=!Object.keys(routePendingEdits().pending).length;updateAIChatControls();}
}
document.getElementById('ai-generate').onclick=()=>generateAI();
async function applyAIProposal() {
  if(!aiProposal || aiFingerprint!==pendingFingerprint())throw new Error('修改要求或草稿已变化，本次未写入，请重新发送');
  const explanation=aiProposal.explanation||aiRequest||'待办修改';
  const saved=await sourceRequest('/api/ai/apply',{id:aiProposal.id,verified:true});
  state=createEditorState({});rememberSource(saved);clearSelection();persistState('AI 修改已写入源码，历史版本已备份',{dirty:false});reloadFrame();aiProposal=null;
  if(aiRequest){aiChat.add('assistant','已写入源码：'+explanation);aiChat.clearInput();aiAttachments.clear();}
  document.getElementById('ai-queue').open=false;document.getElementById('ai-pending-count').textContent='0';document.getElementById('ai-pending').replaceChildren();document.getElementById('ai-empty').hidden=false;
  aiStatus.textContent='已修改并保存：'+explanation+'。原源码已自动备份，可通过“恢复历史版本”找回。';showToast('AI 已修改并保存，主界面已刷新');
}



const aiTestButton=document.getElementById('ai-test'),aiTestResult=document.getElementById('ai-test-result');
let aiTestSequence=0,aiTestRunning=false;
for(const id of ['ai-endpoint','ai-model','ai-key-env','ai-api-key'])document.getElementById(id).addEventListener('input',()=>{
  aiTestSequence++;aiTestResult.hidden=true;
  const badge=document.getElementById('ai-connection');badge.textContent='待测试';badge.dataset.ready='false';
});
aiTestButton.onclick=async()=>{
  if(aiTestRunning)return;
  aiTestRunning=true;const sequence=++aiTestSequence;
  aiTestButton.disabled=true;aiTestButton.textContent='测试中…';aiTestResult.hidden=false;aiTestResult.dataset.kind='loading';aiTestResult.textContent='正在请求模型接口…';
  const badge=document.getElementById('ai-connection');badge.textContent='测试中';badge.dataset.ready='false';
  try {
    const result=await sourceRequest('/api/ai/test',{endpoint:document.getElementById('ai-endpoint').value,model:document.getElementById('ai-model').value,apiKeyEnv:document.getElementById('ai-key-env').value,apiKey:document.getElementById('ai-api-key').value});
    if(sequence!==aiTestSequence)return;
    badge.textContent='已连接';badge.dataset.ready='true';aiTestResult.dataset.kind='success';
    aiTestResult.textContent='已连接 · '+result.elapsedMs+' ms · '+result.model+' — OK';
  }catch(error){
    if(sequence!==aiTestSequence)return;
    badge.textContent='连接失败';badge.dataset.ready='false';aiTestResult.dataset.kind='error';aiTestResult.textContent=error.message;
  }finally{aiTestRunning=false;aiTestButton.disabled=false;aiTestButton.textContent='测试连接';}
};

const modelInput=document.getElementById('ai-model'),modelMenu=document.getElementById('ai-model-menu'),modelSearch=document.getElementById('ai-model-search'),modelOptions=document.getElementById('ai-model-options'),modelStatus=document.getElementById('ai-models-status'),modelLoad=document.getElementById('ai-models-load');
let availableAIModels=[],modelActiveIndex=-1,modelsSequence=0,modelsLoading=false;
function closeModelMenu(){modelMenu.hidden=true;modelInput.setAttribute('aria-expanded','false');document.getElementById('ai-model-toggle').setAttribute('aria-expanded','false');modelInput.removeAttribute('aria-activedescendant');modelSearch.removeAttribute('aria-activedescendant');}
function chooseModel(id){modelInput.value=id;modelInput.dispatchEvent(new Event('input',{bubbles:true}));closeModelMenu();modelInput.focus();}
function renderModelOptions(){
  const term=modelSearch.value.trim().toLowerCase(),models=availableAIModels.filter(id=>id.toLowerCase().includes(term));modelOptions.replaceChildren();modelActiveIndex=-1;
  if(!models.length){const empty=document.createElement('p');empty.className='ai-model-list-empty';empty.textContent=availableAIModels.length?'没有匹配的模型，可在模型名称中手动填写。':'请先加载模型列表，也可手动填写模型名称。';modelOptions.append(empty);return;}
  models.forEach((id,index)=>{const option=document.createElement('button');option.type='button';option.id='ai-model-option-'+index;option.setAttribute('role','option');option.setAttribute('aria-selected',String(id===modelInput.value));option.tabIndex=-1;option.textContent=id;option.onclick=()=>chooseModel(id);modelOptions.append(option);});
}
function openModelMenu(focusSearch=false){
  modelMenu.hidden=false;modelInput.setAttribute('aria-expanded','true');document.getElementById('ai-model-toggle').setAttribute('aria-expanded','true');modelSearch.value='';renderModelOptions();
  modelMenu.classList.toggle('above',document.getElementById('ai-model-picker').getBoundingClientRect().bottom+275>innerHeight-90);
  if(focusSearch)modelSearch.focus();
}
document.getElementById('ai-model-toggle').onclick=()=>modelMenu.hidden?openModelMenu(true):closeModelMenu();
modelInput.addEventListener('click',()=>{if(modelMenu.hidden)openModelMenu();});
modelInput.addEventListener('input',()=>{if(modelMenu.hidden)openModelMenu();modelSearch.value=modelInput.value;renderModelOptions();});
modelSearch.addEventListener('input',renderModelOptions);
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#ai-model-picker'))closeModelMenu();});
for(const input of [modelInput,modelSearch])input.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeModelMenu();modelInput.focus();return;}
  if(event.key==='Tab'){closeModelMenu();return;}
  if(!['ArrowDown','ArrowUp','Enter'].includes(event.key))return;
  if(event.key==='Enter' && modelMenu.hidden)return;
  event.preventDefault();event.stopPropagation();
  if(modelMenu.hidden)openModelMenu();
  const options=[...modelOptions.querySelectorAll('[role="option"]')];if(!options.length)return;
  if(event.key==='Enter'){if(modelActiveIndex>=0)options[modelActiveIndex].click();return;}
  modelActiveIndex=(modelActiveIndex+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
  options.forEach((option,index)=>option.classList.toggle('active',index===modelActiveIndex));
  const active=options[modelActiveIndex];input.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});
});
async function loadAIModels(){
  if(modelsLoading)return;
  modelsLoading=true;const sequence=++modelsSequence;modelLoad.disabled=true;modelLoad.textContent='加载中…';modelStatus.dataset.kind='loading';modelStatus.textContent='正在获取此接口的模型列表…';
  try{
    const result=await sourceRequest('/api/ai/models',{endpoint:document.getElementById('ai-endpoint').value,apiKeyEnv:document.getElementById('ai-key-env').value,apiKey:document.getElementById('ai-api-key').value});
    if(sequence!==modelsSequence)return;
    availableAIModels=result.models;modelStatus.dataset.kind=result.models.length?'success':'empty';modelStatus.textContent=result.models.length?'已从接口加载 '+result.models.length+' 个模型':'接口未返回模型，可手动填写。';renderModelOptions();
  }catch(error){if(sequence!==modelsSequence)return;availableAIModels=[];modelStatus.dataset.kind='error';modelStatus.textContent=error.message;renderModelOptions();}
  finally{modelsLoading=false;modelLoad.disabled=false;modelLoad.textContent='加载模型';}
}
modelLoad.onclick=loadAIModels;
for(const id of ['ai-endpoint','ai-key-env','ai-api-key'])document.getElementById(id).addEventListener('input',()=>{modelsSequence++;availableAIModels=[];closeModelMenu();modelStatus.dataset.kind='empty';modelStatus.textContent='连接信息已改变，请重新加载模型。';});
aiDialog.addEventListener('close',closeModelMenu);

document.getElementById('ai-endpoint').addEventListener('input',()=>{document.getElementById('ai-http-note').hidden=!document.getElementById('ai-endpoint').value.startsWith('http:');});

document.getElementById('ai-start-edit').onclick=()=>{aiDialog.close();document.querySelector('[data-mode="edit"]').click();showToast('选中组件并修改，需 AI 写回的修改会自动进入待办');};
