import {chromium} from 'playwright';
import {createDevServer} from '../dev-server.mjs';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=createDevServer({rootDir:process.cwd(),editorDir:process.cwd()});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:950}});page.setDefaultTimeout(2500);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/editor/sketch-test.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="/editor/editor.css"><body>'}));
 await page.goto(base+'/editor/sketch-test.html');
 await page.evaluate(async()=>{
  const {createAISketch}=await import('./ai-sketch.mjs');
  document.querySelector('#ai-sketch-dialog')?.remove();
  window.sketch=createAISketch({onAttach:async file=>{window.sketchAttachment=await file.arrayBuffer();return true;},onError:message=>{throw new Error(message);}});
  window.sketch.open();
 });
 const canvas=page.locator('#ai-sketch-canvas');
 await page.locator('[data-sketch-tool=select]').click();
 const snapshot=async()=>{await page.locator('[data-sketch-tool=select]').click();await canvas.click({position:{x:20,y:20}});return canvas.evaluate(c=>c.toDataURL());};
 const insert=async(type,x,y)=>{await page.locator(`[data-sketch-tool=${type}]`).click();await canvas.click({position:{x,y}});};
 const edit=async(x,y,value)=>{await canvas.dblclick({position:{x,y}});await page.locator('#ai-sketch-text').fill(value);await page.locator('#ai-sketch-text').press('ControlOrMeta+Enter');};
 const blank=await snapshot();
 await insert('button',180,180);
 const button=await snapshot();assert.notEqual(button,blank,'button is drawn on canvas');
 await canvas.dblclick({position:{x:210,y:195}});await page.locator('#ai-sketch-text').fill('点击保存');await page.locator('[data-sketch-tool=select]').click();
 await canvas.dblclick({position:{x:210,y:195}});assert.equal(await page.locator('#ai-sketch-text').inputValue(),'点击保存','clicking outside saves label edits');await page.locator('#ai-sketch-text').press('Escape');
 await page.locator('#ai-sketch-undo').click();
 await edit(210,195,'立即提交');
 const edited=await snapshot();assert.notEqual(edited,button,'button label changes');
 await page.locator('#ai-sketch-undo').click();assert.equal(await snapshot(),button,'label edit is undoable');
 await page.locator('#ai-sketch-redo').click();assert.equal(await snapshot(),edited,'label edit can be redone');
 await insert('input',430,180);await edit(450,195,'请输入姓名');
 await insert('dropdown',740,180);await edit(770,195,'上海\n北京\n深圳');
 await canvas.dblclick({position:{x:770,y:195}});assert.equal(await page.locator('#ai-sketch-text').inputValue(),'上海\n北京\n深圳');
 await page.locator('#ai-sketch-text').press('Escape');
 await insert('table',180,400);
 await page.locator('#ai-sketch-table-rows').fill('4');await page.locator('#ai-sketch-table-cols').fill('2');await page.locator('#ai-sketch-table-apply').click();
 await edit(205,417,'姓名');
 await canvas.dblclick({position:{x:205,y:417}});assert.equal(await page.locator('#ai-sketch-text').inputValue(),'姓名');await page.locator('#ai-sketch-text').press('Escape');
 await page.locator('#ai-sketch-table-rows').fill('0');await page.locator('#ai-sketch-table-apply').click();assert.match(await page.locator('#ai-sketch-hint').innerText(),/1–20/);
 // A canvas click must transfer focus away from property inputs for delete shortcuts.
 await page.locator('#ai-sketch-table-rows').focus();await canvas.click({position:{x:205,y:417}});
 assert.equal(await canvas.evaluate(c=>document.activeElement===c),true,'selecting an object focuses the canvas');
 await page.keyboard.press('Backspace');assert.equal(await page.locator('#ai-sketch-selection').isVisible(),false,'Backspace deletes a selected table');
 await page.keyboard.press('ControlOrMeta+z');
 const beforePaste=await snapshot();
 await page.evaluate(()=>{
  const c=document.createElement('canvas');c.width=100;c.height=50;const ctx=c.getContext('2d');ctx.fillStyle='#e00000';ctx.fillRect(0,0,100,50);
  c.toBlob(blob=>{const data=new DataTransfer();data.items.add(new File([blob],'clipboard.png',{type:'image/png'}));document.querySelector('#ai-sketch-dialog').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 });
 await page.waitForFunction(()=>document.querySelector('#ai-sketch-hint').textContent.includes('图片已插入'));
 const pasted=await snapshot();assert.notEqual(pasted,beforePaste,'clipboard image is rendered');
 await page.locator('#ai-sketch-undo').click();assert.equal(await snapshot(),beforePaste,'image paste can be undone');
 await page.locator('#ai-sketch-redo').click();assert.equal(await snapshot(),pasted,'image is preserved on redo');
 await page.keyboard.press('Escape');await page.evaluate(()=>window.sketch.open());assert.equal(await snapshot(),pasted,'draft keeps image and components');
 // Move the pasted image and resize it using the bottom-right handle.
 const box=await canvas.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+100,box.y+box.height/2+80);await page.mouse.up();
 assert.notEqual(await snapshot(),pasted,'pasted image can be moved');
 await canvas.click({position:{x:box.width/2+100,y:box.height/2+80}});
 const imageBounds=await page.locator('#ai-sketch-selection').getAttribute('data-bounds');
 const b=JSON.parse(imageBounds);
 await page.mouse.move(box.x+(b.x+b.w)*box.width/1400,box.y+(b.y+b.h)*box.height/(await canvas.getAttribute('height')));await page.mouse.down();await page.mouse.move(box.x+(b.x+b.w)*box.width/1400+50,box.y+(b.y+b.h)*box.height/(await canvas.getAttribute('height'))+25);await page.mouse.up();
 const resized=JSON.parse(await page.locator('#ai-sketch-selection').getAttribute('data-bounds'));assert.ok(resized.w>b.w,'image resize handle increases size');
 // Vertical-only drags resize images while preserving their aspect ratio.
 const height=Number(await canvas.getAttribute('height'));
 const corner=(bounds,left=false,top=false)=>({x:box.x+(bounds.x+(left?0:bounds.w))*box.width/1400,y:box.y+(bounds.y+(top?0:bounds.h))*box.height/height});
 let handle=corner(resized);await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(handle.x,handle.y+35);await page.mouse.up();
 const vertical=JSON.parse(await page.locator('#ai-sketch-selection').getAttribute('data-bounds'));assert.ok(vertical.w>resized.w,'dragging vertically resizes image');assert.ok(Math.abs(vertical.h/vertical.w-resized.h/resized.w)<.001,'image aspect ratio is preserved');
 handle=corner(vertical,true,true);await page.mouse.move(handle.x,handle.y);assert.equal(await canvas.evaluate(c=>c.style.cursor),'nwse-resize','corner cursor indicates resizing');await page.mouse.down();await page.mouse.move(handle.x+20,handle.y+10);await page.mouse.up();
 const smaller=JSON.parse(await page.locator('#ai-sketch-selection').getAttribute('data-bounds'));assert.ok(smaller.w<vertical.w,'top-left corner can shrink image');assert.ok(Math.abs(smaller.x+smaller.w-vertical.x-vertical.w)<.001,'opposite corner stays fixed');
 await page.keyboard.press('Delete');assert.equal(await page.locator('#ai-sketch-selection').isVisible(),false,'Delete removes selected image');await page.locator('#ai-sketch-undo').click();
 for(const p of [{x:210,y:195},{x:450,y:195},{x:770,y:195}]){await canvas.click({position:p});await page.keyboard.press('Backspace');assert.equal(await page.locator('#ai-sketch-selection').isVisible(),false,'Backspace removes selected control');await page.keyboard.press('ControlOrMeta+z');}
 // Delete while editing removes text, not the selected component.
 await canvas.dblclick({position:{x:210,y:195}});await page.locator('#ai-sketch-text').press('Backspace');assert.equal(await page.locator('#ai-sketch-text').isVisible(),true);await page.locator('#ai-sketch-text').press('Escape');
 // Editing again after image operations still targets the correct component.
 await page.locator('[data-sketch-tool=select]').click();await canvas.dblclick({position:{x:210,y:195}});
 await page.locator('#ai-sketch-text').fill('确认保存');await page.locator('#ai-sketch-text').press('ControlOrMeta+Enter');
 const upload=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=30;c.height=20;c.getContext('2d').fillRect(0,0,30,20);return c.toDataURL().split(',')[1];});
 const beforeUpload=await snapshot();await page.locator('#ai-sketch-image').setInputFiles({name:'upload.png',mimeType:'image/png',buffer:Buffer.from(upload,'base64')});
 await page.waitForFunction(()=>!document.querySelector('#ai-sketch-done').disabled);assert.notEqual(await snapshot(),beforeUpload,'file chooser image is rendered');
 await mkdir('output/ai-sketch',{recursive:true});await page.screenshot({path:'output/ai-sketch/components-desktop.png'});
 await page.setViewportSize({width:520,height:760});
 assert.ok(await page.locator('[data-sketch-tool=dropdown]').isVisible());
 assert.equal(await page.locator('#ai-sketch-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'toolbar fits narrow dialog');
 await page.screenshot({path:'output/ai-sketch/components-mobile.png'});
 await page.locator('#ai-sketch-done').click();await page.waitForFunction(()=>window.sketchAttachment?.byteLength>100);
 assert.equal(await page.locator('#ai-sketch-dialog').isVisible(),false,'completed composition is attached');
 await page.evaluate(()=>window.sketch.open());assert.equal(await canvas.evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return d.every(v=>v===255);}),true,'attachment clears draft');
 assert.deepEqual(errors,[]);
 console.log('AI sketch components: editable controls, table cells/dimensions, clipboard images, movement, resizing, history, draft, export and mobile layout passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
