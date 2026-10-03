import { readdir, readFile, realpath, mkdir, writeFile, rename, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createVisualPatchEngine } from './visual-patch-engine.mjs';
import { readVisualEdits } from './visual-edits-store.mjs';

const runFile = promisify(execFile);
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 20);
const ignored = name => name.startsWith('.') || ['node_modules', '__pycache__'].includes(name);
const error = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export const projectUrl = (id, entry) => `/project/${id}/${entry.split('/').map(encodeURIComponent).join('/')}`;

// A selected folder is the boundary, including for symlinks. No arbitrary path API.
export async function insideProject(root, entry) {
  root=await realpath(root);
  if (typeof entry !== 'string' || entry.includes('\0') || entry.includes('\\') || isAbsolute(entry)
    || entry.split('/').some(part => part === '..' || part.startsWith('.'))) throw error('文件必须位于所选项目文件夹内', 403);
  const path = await realpath(resolve(root, entry));
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw error('不能读取项目文件夹外的链接', 403);
  return path;
}

async function discoverPages(root, folder = '', result = []) {
  for (const item of await readdir(join(root, folder), { withFileTypes: true })) {
    if (ignored(item.name) || item.isSymbolicLink()) continue;
    const entry = folder ? `${folder}/${item.name}` : item.name;
    if (item.isDirectory()) await discoverPages(root, entry, result);
    else if (/\.html?$/i.test(item.name)) result.push(entry);
    if (result.length > 2000) throw error('HTML 文件超过 2000 个，请选择更具体的项目文件夹');
  }
  return result.sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b, 'zh-CN')));
}

export function createWorkspaceManager(editorRoot, { registryDir = join(editorRoot, '.editor-workspaces') } = {}) {
  const registryFile = join(registryDir, 'projects.json');
  let registry = [];
  const ready = readFile(registryFile, 'utf8').then(text => { registry = JSON.parse(text); }).catch(e => { if (e.code !== 'ENOENT') throw e; });
  let queue = Promise.resolve();
  async function persist() {
    queue = queue.catch(() => {}).then(async () => {
      await mkdir(dirname(registryFile), { recursive: true });
      await writeFile(`${registryFile}.tmp`, JSON.stringify(registry, null, 2));
      await rename(`${registryFile}.tmp`, registryFile);
    });
    return queue;
  }
  async function get(id = 'builtin') {
    await ready;
    if (id === 'builtin') return { id, name: '当前驾驶舱原型', root: editorRoot, builtin: true };
    const project = registry.find(project => project.id === id);
    if (!project) throw error('项目未关联，请重新打开项目文件夹', 404);
    let root;
    try { root = await realpath(project.root); } catch { throw error('项目文件夹已移动或不可用，请重新打开', 404); }
    return { ...project, root, builtin: false };
  }
  async function open(folder) {
    await ready;
    if (typeof folder !== 'string' || !folder.trim() || !isAbsolute(folder.trim())) throw error('请输入本机文件夹的完整路径');
    let root;
    try {root = await realpath(folder.trim());} catch {throw error('找不到这个文件夹，请检查路径或重新选择');}
    if (!(await stat(root)).isDirectory()) throw error('请选择文件夹，而不是单个文件');
    const pages = await discoverPages(root);
    if (!pages.length) throw error('文件夹中没有 HTML 文件；需要构建的项目请先生成静态页面');
    const id = digest(root), project = { id, name: basename(root), root, lastOpened: Date.now() };
    registry = [project, ...registry.filter(item => item.id !== id)].slice(0, 30);
    await persist();
    return { ...project, pages, entry: pages[0], builtin: false };
  }
  async function remove(id) {
    await ready;
    if (id === 'builtin') throw error('不能移除内置项目');
    if (typeof id !== 'string' || !registry.some(project => project.id === id)) throw error('项目未关联，请刷新项目列表',404);
    registry = registry.filter(project => project.id !== id);
    await persist();
    return { ok:true };
  }
  async function describe(id = 'builtin', entry) {
    const project = await get(id);
    if(project.builtin) {
      try {await stat(join(project.root,'prototype.html'));}
      catch {throw error('尚未打开 HTML 项目，请选择项目文件夹',404);}
    }
    const pages = project.builtin ? ['prototype.html'] : await discoverPages(project.root);
    entry ||= pages[0];
    if (!entry || !pages.includes(entry)) throw error('所选 HTML 已不存在，请从项目中重新选择页面', 404);
    const key = digest(entry);
    return {
      ...project, pages, entry,
      url: project.builtin ? '/prototype.html' : projectUrl(id, entry),
      editsFile: project.builtin ? join(project.root, 'visual-edits.json') : join(project.root, '.visual-editor', key, 'visual-edits.json'),
      annotationsFile: project.builtin ? join(project.root, 'change-annotations.json') : join(project.root, '.visual-editor', key, 'change-annotations.json'),
      backupDir: project.builtin ? join(project.root, '.visual-editor-backups') : join(project.root, '.visual-editor', key, 'backups'),
    };
  }
  async function list() {
    await ready;
    let builtin=[];
    try {await stat(join(editorRoot,'prototype.html'));builtin=[{id:'builtin',name:'当前驾驶舱原型',root:editorRoot,builtin:true}];} catch {}
    return [...builtin, ...registry];
  }
  return { get, open, remove, describe, list };
}

export async function chooseProjectFolder() {
  if (process.platform !== 'darwin') throw error('当前系统请在下方粘贴文件夹完整路径');
  try {
    const { stdout } = await runFile('/usr/bin/osascript', ['-e', 'POSIX path of (choose folder with prompt "选择要编辑的 HTML 项目文件夹")'], { timeout: 120000 });
    return stdout.trim();
  } catch (e) {
    if (String(e.stderr).includes('-128')) return null;
    throw error('未能打开系统文件夹选择器，请粘贴文件夹完整路径');
  }
}

// Relative paths keep their folder hierarchy. Root-relative HTML/CSS resources
// are scoped to the mounted project; arbitrary application API routing is not emulated.
export function scopeRootUrls(source, prefix, css = false) {
  source = source.replace(/url\(\s*(['"]?)(\/(?!\/)[^)'"\s]*)\1\s*\)/gi, (_, quote, path) => `url(${quote}${prefix}${path.slice(1)}${quote})`);
  if (css) return source.replace(/(@import\s+['"])(\/(?!\/)[^'"]+)/gi, (_, start, path) => start + prefix + path.slice(1));
  return source.replace(/(\b(?:src|href|poster|action)\s*=\s*['"])(\/(?!\/)[^'"]*)/gi, (_, start, path) => start + prefix + path.slice(1));
}

export function projectHtml(source, id, entry) {
  const config = JSON.stringify({ id, entry }).replace(/</g, '\\u003c');
  const injection = `<script>window.__visualEditorProject=${config};</script><script src="/editor/visual-edits-runtime.js" defer></script>`;
  source = scopeRootUrls(source, `/project/${id}/`);
  return /<\/head\s*>/i.test(source) ? source.replace(/<\/head\s*>/i, () => `${injection}</head>`) : injection + source;
}

function standalonePatchScript(patches) {
  return `<script>(()=>{const patches=${JSON.stringify(patches).replace(/</g, '\\u003c')};const engine=(${createVisualPatchEngine.toString()})(document);let timer;const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(apply,60)});function apply(){engine.apply(patches);observer.takeRecords()}observer.observe(document.documentElement,{subtree:true,childList:true});if(document.readyState==='loading')addEventListener('DOMContentLoaded',apply);else apply();})();</script>`;
}

// ZIP STORE (uncompressed) keeps exports dependency-free and preserves every asset.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipFiles(files) {
  const parts = [], central = []; let offset = 0;
  for (const [name, bytes] of files) {
    const filename = Buffer.from(name), crc = crc32(bytes), header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    parts.push(header, filename, bytes);
    const item = Buffer.alloc(46);item.writeUInt32LE(0x02014b50, 0); item.writeUInt16LE(20, 4);item.writeUInt16LE(20, 6);item.writeUInt16LE(0x800, 8);
    item.writeUInt32LE(crc, 16); item.writeUInt32LE(bytes.length, 20); item.writeUInt32LE(bytes.length, 24);item.writeUInt16LE(filename.length, 28);item.writeUInt32LE(offset, 42);
    central.push(item, filename); offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);end.writeUInt32LE(0x06054b50, 0);end.writeUInt16LE(files.length, 8);end.writeUInt16LE(files.length, 10);end.writeUInt32LE(directory.length, 12);end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
export async function exportProjectFiles(manager, id, entry, currentPatches, {sourceOnly=false} = {}) {
  const project = await manager.describe(id, entry), files = [];let size = 0;
  if(sourceOnly && Object.keys(currentPatches || {}).length)throw error(`${entry} 仍有未写入源码的修改，请先保存并完成 AI 待办`,409);
  async function walk(folder = '') {
    for (const item of await readdir(join(project.root, folder), { withFileTypes: true })) {
      if (ignored(item.name) || item.isSymbolicLink()) continue;
      const path = folder ? `${folder}/${item.name}` : item.name;
      if (item.isDirectory()) { await walk(path); continue; }
      const absolute = await insideProject(project.root, path);
      const info = await stat(absolute); size += info.size;
      if (size > 200 * 1024 * 1024 || files.length >= 10000) throw error('项目超过导出限制（200MB 或 10000 个文件），请选择更具体的目录');
      let bytes = await readFile(absolute);
      if (/\.html?$/i.test(path)) {
        const page = await manager.describe(id, path);
        const savedPatches = sourceOnly || path !== entry ? (await readVisualEdits(page.editsFile)).patches : {};
        if(sourceOnly && Object.keys(savedPatches).length)throw error(`${path} 仍有未写入源码的修改，请打开该页面保存并完成 AI 待办`,409);
        const patches = sourceOnly ? {} : structuredClone(path === entry ? currentPatches : savedPatches);
        for (const patch of Object.values(patches)) {
          if (patch.insert?.html) patch.insert.html = patch.insert.html.replaceAll(`/project/${id}/`, '/');
          for (const [key,value] of Object.entries(patch.styles || {})) patch.styles[key] = value.replaceAll(`/project/${id}/`, '/');
        }
        if (Object.keys(patches).length) {
          const html = bytes.toString('utf8'), script = standalonePatchScript(patches);
          bytes = Buffer.from(/<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, () => script + '</body>') : html + script);
        }
      }
      files.push([path, bytes]);
    }
  }
  await walk();
  return files;
}

export async function exportProjectZip(...args) {
  return zipFiles(await exportProjectFiles(...args));
}
