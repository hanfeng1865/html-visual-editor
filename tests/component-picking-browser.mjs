import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chartTemplates } from '../chart-components.mjs';
import { CARD_SELECTOR } from '../editor-components.mjs';

const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1200,height:1800}});
  await page.setContent(`<style>body{margin:0}.item{width:340px;margin:10px;box-sizing:border-box} .surface{padding:20px;border:1px solid #ddd;height:150px} </style>
    ${Object.entries(chartTemplates).map(([type,html])=>html.replace('<div ',`<div id="${type}" class="item" `)).join('')}
    <div id="future" class="item surface"><div><span id="future-text">未来组件</span><button id="inner">操作</button></div></div>
    <div id="explicit" data-editor-component="container" class="item" style="height:80px"><div><span>无外观容器</span></div></div>
    <section id="semantic" class="item" style="height:80px"><h3>内容板块</h3></section>
    <div id="background" class="item" style="height:100px"><p>画布背景</p></div>`);
  const source=await readFile(new URL('../element-picking.mjs',import.meta.url),'utf8');
  await page.addScriptTag({type:'module',content:source.replace(/export function /g,'function ')+'\nwindow.pickElementAtPoint=pickElementAtPoint;'});
  await page.waitForFunction(()=>typeof window.pickElementAtPoint==='function');
  const pick=(selector,x,y,exact=false)=>page.locator(selector).evaluate((el,opts)=>{
    const r=el.getBoundingClientRect();
    const target=window.pickElementAtPoint(document,r.left+opts.x,r.top+opts.y,opts);
    return target?.id || target?.tagName.toLowerCase() || null;
  },{x,y,exact,cardSelector:CARD_SELECTOR});
  for(const type of ['bar','line','donut']) {
    assert.equal(await pick('#'+type,330,10),type,'chart padding selects entire chart');
    assert.equal(await pick('#'+type+' svg',100,80),type,'chart graphic selects entire chart');
    assert.equal(await pick('#'+type+' svg',100,80,true),'svg','exact pick can access chart graphic');
    assert.equal(await pick('#'+type+' > p:first-of-type',10,10),'p','chart title can still be edited');
  }
  assert.equal(await pick('#future',320,130),'future','unknown styled component is selectable');
  assert.equal(await pick('#future-text',10,8),'future-text','unknown component text stays editable');
  assert.equal(await pick('#inner',3,3),'inner','nested control wins over component');
  assert.equal(await pick('#explicit',300,60),'explicit','explicit component requires no class or visible decoration');
  assert.equal(await pick('#semantic',300,60),'semantic','semantic section is selectable');
  assert.equal(await pick('#background',300,70),null,'undecorated page whitespace stays background');
  await page.addStyleTag({content:'.ve-selected{box-shadow:0 0 0 5px #2d79e622!important}'});
  await page.locator('#future').evaluate(el=>{el.style.border='0';el.style.boxShadow='0 2px 10px #0002';});
  assert.equal(await pick('#future',320,130),'future','shadow alone identifies a component');
  await page.locator('#future').evaluate(el=>el.classList.add('ve-hover'));
  assert.equal(await pick('#future',320,130),'future','hover must not lose a shadow component');
  await page.locator('#future').evaluate(el=>el.classList.add('ve-selected'));
  assert.equal(await pick('#future',320,130),'future','selection must not lose a shadow component');
  await page.locator('#background').evaluate(el=>el.classList.add('ve-selected'));
  assert.equal(await pick('#background',300,70),null,'selection halo alone does not make a component');
  await page.locator('#future').evaluate(el=>el.setAttribute('data-ve-locked','true'));
  assert.equal(await pick('#future',320,130),null,'locked components cannot be selected');
  console.log('PASS: chart roots and exact graphics, future surfaces, explicit components, semantic sections, nested controls, background and locks');
} finally {await browser.close();}
