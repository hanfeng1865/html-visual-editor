import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { CARD_SELECTOR } from '../editor-components.mjs';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(`<style>
    body{margin:0} .panel{margin:20px;padding:20px;width:640px;height:300px;border:1px solid #ddd}
    h2{margin:0} .chart-space{height:100px} button{padding:12px} svg{width:80px;height:40px}
  </style><article id="trend" class="panel"><h2 id="title">收款趋势</h2>
    <div id="chart-space" class="chart-space"><div></div></div>
    <button id="range">近30天</button><svg id="chart"><rect width="80" height="40"/></svg>
    <article id="nested" class="panel" style="width:100px;height:40px;margin:0;padding:5px"><span>内层面板</span></article>
  </article><button id="metric">今日应收</button>
  <div id="background" style="height:200px"><p>画布空白</p></div>`);
  const source = await readFile(new URL('../element-picking.mjs', import.meta.url), 'utf8');
  await page.addScriptTag({type:'module',content:source.replace(/export function /g,'function ')+'\nwindow.pickElementAtPoint=pickElementAtPoint;'});
  await page.waitForFunction(()=>typeof window.pickElementAtPoint==='function');
  async function pick(selector, x, y, exact=false) {
    return page.locator(selector).evaluate((el, options)=>{
      const r=el.getBoundingClientRect();
      return window.pickElementAtPoint(document,r.left+options.x,r.top+options.y,options)?.id || null;
    }, {x,y,exact,cardSelector:CARD_SELECTOR});
  }
  assert.equal(await pick('#trend',620,20),'trend','panel padding selects the whole panel');
  assert.equal(await pick('#chart-space',400,50),'trend','blank child area selects its panel');
  assert.equal(await pick('#nested',100,40),'nested','nearest nested panel wins');
  assert.equal(await pick('#title',20,12),'title','text remains individually selectable');
  assert.equal(await pick('#range',5,5),'range','inner button remains individually selectable');
  assert.equal(await pick('#chart',20,20),'chart','chart remains individually selectable');
  assert.equal(await pick('#metric',5,5),'metric','small metric button remains selectable');
  assert.equal(await pick('#background',400,100),null,'page background remains unselected');
  assert.equal(await pick('#chart-space',400,50,true),'chart-space','exact picking keeps the child container');
  console.log('PASS: panel padding, child whitespace, nested panels, text, buttons, charts, background and exact picking');
} finally {
  await browser.close();
}
