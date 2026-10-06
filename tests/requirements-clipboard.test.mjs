import test from 'node:test';
import assert from 'node:assert/strict';
import {requirementsClipboardHTML} from '../requirements-ui.mjs';

test('clipboard tables carry explicit widths without editor stylesheets',()=>{
 const html=requirementsClipboardHTML('## Who\n\n| 使用者 | 主要职责 | 建议数据范围及操作权限 |\n| --- | --- | --- |\n| 财务人员 | 核对应收、回款、付款及票税 | 查看授权范围内财务数据；记录、核对及导出 |');
 assert.match(html,/<table[^>]*width="900"/);
 assert.match(html,/<colgroup>.*<col[^>]*width="\d+".*<\/colgroup>/s);
 const widths=[...html.matchAll(/<col\s+width="(\d+)"/g)].map(m=>+m[1]);
 assert.equal(widths.reduce((a,b)=>a+b,0),900);assert.equal(widths.length,3);
 assert.ok(widths[2]>widths[0],'long permission text receives more width than role names');
 assert.match(html,/<td[^>]*width="\d+"[^>]*style="[^"]*width:/);
 assert.match(html,/查看授权范围内财务数据/);
});

test('clipboard formatting keeps text escaped and each table sized independently',()=>{
 const html=requirementsClipboardHTML('| 字段 | 说明 |\n| --- | --- |\n| <img src=x> | &文本 |\n\n| 单列 |\n| --- |\n| 内容 |');
 assert.equal((html.match(/<table /g)||[]).length,2);assert.match(html,/&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img/);
 assert.match(html,/<col width="900"/);
});
