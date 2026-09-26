import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('editor help stays collapsed by default and exposes a persistent toggle', async () => {
  const [html, css, script] = await Promise.all([
    readFile(new URL('../editor.html', import.meta.url), 'utf8'),
    readFile(new URL('../editor.css', import.meta.url), 'utf8'),
    readFile(new URL('../editor.js', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="editor-help-toggle"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="editor-help-content"/);
  assert.match(html, /id="editor-help-content"[^>]*hidden/);
  assert.match(css, /grid-template-columns:40px minmax\(0,1fr\) 0/);
  assert.match(css, /\.editor-main\.help-open\s*\{[^}]*grid-template-columns:220px minmax\(0,1fr\) 0/s);
  assert.match(script, /HELP_OPEN_KEY/);
  assert.match(script, /classList\.toggle\('help-open'/);
  assert.match(script, /helpContent\.hidden = !open/);
  assert.match(script, /localStorage\.setItem\(HELP_OPEN_KEY/);
});
