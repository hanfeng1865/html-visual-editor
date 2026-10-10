import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {decodePRDSnapshot} from '../prd-annotations-model.mjs';
const viewport={width:1440,height:660,scrollY:320};
test('compressed snapshots decode large pages within the transport limit and accept earlier plain snapshots',()=>{
 const html='<main>'+'<span>统计口径与交互</span>'.repeat(90000)+'</main>',htmlGzip=gzipSync(html).toString('base64');
 assert.ok(Buffer.byteLength(html)>1500000);assert.ok(htmlGzip.length<1500000);
 assert.deepEqual(decodePRDSnapshot({...viewport,htmlGzip}),{...viewport,html});
 assert.deepEqual(decodePRDSnapshot({...viewport,html:'<main>兼容</main>'}),{...viewport,html:'<main>兼容</main>'});
});
test('invalid or oversized decompressed snapshots are rejected before launching a browser',()=>{
 const htmlGzip=gzipSync('<main>统计</main>').toString('base64');
 for(const snapshot of [{...viewport,htmlGzip:'invalid'},{...viewport,htmlGzip:Buffer.from('not gzip').toString('base64')},{...viewport,htmlGzip,html:'ambiguous'},{...viewport,htmlGzip,width:9999}])assert.throws(()=>decodePRDSnapshot(snapshot),/截图/);
 const oversized=gzipSync(Buffer.alloc(17*1024*1024,32)).toString('base64');
 assert.throws(()=>decodePRDSnapshot({...viewport,htmlGzip:oversized}),/解压失败/);
});
