import test from 'node:test';
import assert from 'node:assert/strict';

import { createStandaloneHtml } from '../export-html.mjs';

const bytes = value => new TextEncoder().encode(value).buffer;

function response(body, contentType) {
  return {
    ok: true,
    text: async () => body,
    arrayBuffer: async () => bytes(body),
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
  };
}

test('export embeds local images and the Lucide runtime into one standalone HTML file', async () => {
  const source = `<!doctype html><html><head></head><body>
    <img src="assets/dashboard.png">
    <script src="assets/lucide.min.js"></script>
    <script>const card = icon => \`<img src="assets/\${icon}">\`;</script>
  </body></html>`;
  const fetchImpl = async path => {
    if (path === 'assets/lucide.min.js') return response('window.marker="$&";window.lucide={createIcons(){}};', 'text/javascript');
    return response(path, 'image/png');
  };

  const output = await createStandaloneHtml({ source, patches: {}, fetchImpl });

  assert.doesNotMatch(output, /<script[^>]+src=["']assets\/lucide\.min\.js/);
  assert.match(output, /window\.marker="\$&"/);
  assert.match(output, /window\.lucide=\{createIcons\(\)\{\}\};/);
  assert.match(output, /src="data:image\/png;base64,/);
  assert.doesNotMatch(output, /assets\/\$\{icon\}/);
  assert.match(output, /window\.__visualEditorAssets\[icon\]/);
});

test('export keeps visual patches in the standalone HTML', async () => {
  const source = '<!doctype html><html><head></head><body><h1>before</h1><script src="assets/lucide.min.js"></script></body></html>';
  const fetchImpl = async path => path.endsWith('.js')
    ? response('window.lucide={createIcons(){}};', 'text/javascript')
    : response(path, 'image/png');
  const patches = { title: { selector: 'h1', text: 'after' } };

  const output = await createStandaloneHtml({ source, patches, fetchImpl });

  assert.match(output, /const patches = \{"title":\{"selector":"h1","text":"after"\}\}/);
  assert.match(output, /id="visual-editor-export-patches"/);
});

test('export keeps the original element selector for position patches', async () => {
  const source = '<!doctype html><html><head></head><body><div class="tabs"><button>今天</button><button>昨天</button></div><script src="assets/lucide.min.js"></script></body></html>';
  const fetchImpl = async path => path.endsWith('.js')
    ? response('window.lucide={createIcons(){}};', 'text/javascript')
    : response(path, 'image/png');
  const patches = {
    yesterday: {
      selector: '.tabs > button:nth-of-type(2)',
      position: { parent: '.tabs', index: 0 },
    },
  };

  const output = await createStandaloneHtml({ source, patches, fetchImpl });

  assert.match(output, /"selector":"\.tabs > button:nth-of-type\(2\)"/);
  assert.match(output, /"position":\{"parent":"\.tabs","index":0\}/);
});
