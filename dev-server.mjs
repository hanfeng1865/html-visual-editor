import { readAnnotations, writeAnnotations } from './change-annotations-store.mjs';
import {ensureSourceOrigin,readSourceState,saveSource,restoreSource,listSourceVersions,readSourceVersion} from './source-store.mjs';
import { createReadStream, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorkspaceManager, chooseProjectFolder, insideProject, projectHtml, scopeRootUrls, exportProjectZip } from './project-workspaces.mjs';
import { readVisualEdits, writeVisualEdits, validateVisualEdits, listVisualHistory, readVisualHistory, restoreVisualHistory, visualHistoryAt } from './visual-edits-store.mjs';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.htm': 'text/html; charset=utf-8',
};

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function resolveInside(rootDir, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const withoutLeadingSlash = decoded.replace(/^[/\\]+/, '');
  const requested = normalize(withoutLeadingSlash) || 'editor.html';
  if (requested === '..' || requested.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) return null;
  const target = resolve(rootDir, requested);
  const rel = relative(rootDir, target);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

async function readJsonBody(request, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求内容过大'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求 JSON 格式无效'), { statusCode: 400 }); }
}

const editorDirectory = fileURLToPath(new URL('.', import.meta.url));
let configuration = {};
try {
  configuration = JSON.parse(readFileSync(new URL('./editor-config.json', import.meta.url), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

export function createDevServer({ rootDir = configuration.prototypeRoot || editorDirectory, editorDir = editorDirectory } = {}) {
  const projectRoot = resolve(rootDir);
  const workspaces = createWorkspaceManager(projectRoot, { registryDir: join(editorDir, '.editor-workspaces') });

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/' || url.pathname === '/editor' || url.pathname === '/editor/') {
        response.writeHead(302, { location: '/editor/editor.html' });
        return response.end();
      }
      // Mutating APIs are local-editor requests, never cross-site form submissions.
      if (request.method === 'POST') {
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) return json(response, 403, { error:'仅允许本地编辑器发起操作' });
        if (!(request.headers['content-type'] || '').startsWith('application/json')) return json(response, 415, { error:'需要 JSON 请求' });
      }
      const workspaceId = url.searchParams.get('project') || 'builtin';
      const entry = url.searchParams.get('entry') || undefined;
      if (url.pathname === '/api/projects' && request.method === 'GET') return json(response, 200, await workspaces.list());
      if (url.pathname === '/api/projects/open' && request.method === 'POST') {
        const body = await readJsonBody(request);
        return json(response, 200, await workspaces.open(body.path));
      }
      if (url.pathname === '/api/projects/remove' && request.method === 'POST') {
        const body = await readJsonBody(request);
        return json(response, 200, await workspaces.remove(body.id));
      }
      if (url.pathname === '/api/projects/choose' && request.method === 'POST') {
        const folder = await chooseProjectFolder();
        return json(response, 200, folder ? await workspaces.open(folder) : { cancelled:true });
      }
      if (url.pathname === '/api/projects/current' && request.method === 'GET') return json(response, 200, await workspaces.describe(workspaceId, entry));
      if(['/api/source-state','/api/source-save','/api/source-history'].includes(url.pathname)) {
        const project=await workspaces.describe(workspaceId,entry);
        if(url.pathname==='/api/source-state' && request.method==='GET')return json(response,200,await ensureSourceOrigin(project,editorDir));
        if(url.pathname==='/api/source-save' && request.method==='POST')return json(response,200,await saveSource(project,editorDir,await readJsonBody(request,25*1024*1024)));
        if(url.pathname==='/api/source-history') {
          await ensureSourceOrigin(project,editorDir);
          if(request.method==='GET') {
            let id=url.searchParams.get('id');
            const versions=await listSourceVersions(project);
            let match;
            if(url.searchParams.has('at')){match=versions.find(v=>Date.parse(v.savedAt)<=Date.parse(url.searchParams.get('at')) && !v.beforeRestore);id=match?.id||'original';}
            if(!id)return json(response,200,{versions});
            const record=await readSourceVersion(project,id);
            const value={version:1,patches:record.patches,source:record.files[project.entry],sourceFiles:record.files,assetBase:`/source-version/${workspaceId}/${encodeURIComponent(project.entry)}/${encodeURIComponent(record.id)}/`};
            return json(response,200,url.searchParams.has('at')?{value,savedAt:match?.savedAt||null}:value);
          }
          if(request.method==='POST')return json(response,200,await restoreSource(project,editorDir,await readJsonBody(request,25*1024*1024)));
        }
        return json(response,405,{error:'不支持此操作'});
      }
      if (url.pathname === '/api/projects/export' && request.method === 'POST') {
        const value = validateVisualEdits(await readJsonBody(request));
        const zip = await exportProjectZip(workspaces, workspaceId, entry, value.patches);
        response.writeHead(200, {'content-type':'application/zip','content-disposition':'attachment; filename="html-project.zip"'});
        return response.end(zip);
      }
      // Keep the existing built-in project's filenames and behavior unchanged.
      const files = () => workspaceId === 'builtin'
        ? Promise.resolve({ editsFile:join(projectRoot,'visual-edits.json'), annotationsFile:join(projectRoot,'change-annotations.json'), backupDir:join(projectRoot,'.visual-editor-backups') })
        : workspaces.describe(workspaceId,entry);
      if (url.pathname === '/api/change-annotations') {
        const { annotationsFile:file } = await files();
        if (request.method === 'GET') return json(response, 200, await readAnnotations(file));
        if (request.method === 'POST') {
          await writeAnnotations(file, await readJsonBody(request));
          return json(response, 200, { ok:true });
        }
        response.writeHead(405, { allow:'GET, POST' });
        return response.end('Method Not Allowed');
      }
      if (url.pathname === '/api/visual-edits') {
        const { editsFile, backupDir } = await files();
        if (request.method === 'GET') return json(response, 200, await readVisualEdits(editsFile));
        if (request.method === 'POST') {
          const value = await readJsonBody(request);
          const stored = await writeVisualEdits({ filePath: editsFile, backupDir, value });
          return json(response, 200, { ok: true, patchCount: Object.keys(stored.patches).length });
        }
        response.writeHead(405, { allow: 'GET, POST' });
        return response.end('Method Not Allowed');
      }
      if(url.pathname==='/api/visual-history') {
        const {editsFile:filePath,backupDir}=await files();
        if(request.method==='GET' && url.searchParams.has('at'))return json(response,200,await visualHistoryAt({filePath,backupDir,at:url.searchParams.get('at')}));
        if(request.method==='GET')return json(response,200,url.searchParams.has('id')?await readVisualHistory({filePath,backupDir,id:url.searchParams.get('id')}):{versions:await listVisualHistory({filePath,backupDir})});
        if(request.method==='POST') {
          const {id,draft}=await readJsonBody(request);
          const value=await restoreVisualHistory({filePath,backupDir,id,draft});
          return json(response,200,value);
        }
        response.writeHead(405,{allow:'GET, POST'});return response.end('Method Not Allowed');
      }

      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { allow: 'GET, HEAD' });
        return response.end('Method Not Allowed');
      }
      const archived=url.pathname.match(/^\/source-version\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
      if(archived) {
        const [,id,encodedEntry,encodedVersion,encodedPath]=archived;
        const project=await workspaces.describe(id,decodeURIComponent(encodedEntry));
        const record=await readSourceVersion(project,decodeURIComponent(encodedVersion));
        const path=decodeURIComponent(encodedPath);
        if(path.split('/').some(part=>part==='..'||part.startsWith('.')) || path.includes('\\'))return json(response,403,{error:'无效资源路径'});
        const extension=extname(path).toLowerCase(),prefix=`/source-version/${id}/${encodedEntry}/${encodedVersion}/`;
        let content=record.files[path];
        if(content===undefined)content=await readFile(await insideProject(project.root,path));
        if(extension==='.css')content=scopeRootUrls(String(content),prefix,true);
        response.writeHead(200,{'content-type':mimeTypes[extension]||'application/octet-stream','cache-control':'no-store'});return response.end(content);
      }
      const mounted = url.pathname.match(/^\/project\/([a-f0-9]{20})\/(.*)$/);
      if (mounted) {
        const project = await workspaces.get(mounted[1]);
        let path;
        try { path = decodeURIComponent(mounted[2]); } catch { return json(response,400,{error:'文件路径无效'}); }
        let file = await insideProject(project.root,path);
        if ((await stat(file)).isDirectory()) {
          path = `${path.replace(/\/$/,'')}${path?'/':''}index.html`;
          file = await insideProject(project.root,path);
        }
        const extension = extname(file).toLowerCase();
        response.writeHead(200, {'content-type':mimeTypes[extension] || 'application/octet-stream','cache-control':'no-store'});
        if (request.method === 'HEAD') return response.end();
        if (['.html','.htm'].includes(extension)) return response.end(projectHtml(await readFile(file,'utf8'),project.id,path));
        if (extension === '.css') return response.end(scopeRootUrls(await readFile(file,'utf8'),`/project/${project.id}/`,true));
        return createReadStream(file).pipe(response);
      }
      const isEditorFile = url.pathname.startsWith('/editor/');
      const staticRoot = isEditorFile ? resolve(editorDir) : projectRoot;
      const filePath = resolveInside(staticRoot, isEditorFile ? url.pathname.slice('/editor/'.length) : url.pathname);
      if (filePath && (relative(staticRoot,filePath).split(/[\\/]/).some(part => part.startsWith('.')) || filePath === join(resolve(editorDir), 'editor-config.json'))) return json(response,403,{error:'不提供隐藏配置文件'});
      if (!filePath) return json(response, 403, { error: '禁止访问项目目录之外的路径' });
      let fileStat;
      try { fileStat = await stat(filePath); } catch (error) {
        if (error?.code === 'ENOENT') return json(response, 404, { error: '文件不存在' });
        throw error;
      }
      const actualPath = fileStat.isDirectory() ? join(filePath, 'index.html') : filePath;
      await stat(actualPath);
      response.writeHead(200, {
        'content-type': mimeTypes[extname(actualPath).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      if (request.method === 'HEAD') return response.end();
      createReadStream(actualPath).pipe(response);
    } catch (error) {
      json(response, error.statusCode || 500, { error: error.message || '服务器错误' });
    }
  });
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(argumentValue('--port', process.env.PORT || '4174'));
  const host = argumentValue('--host', '127.0.0.1');
  const server = createDevServer();
  server.listen(port, host, () => {
    console.log(`Visual editor development server: http://${host}:${port}/editor/editor.html`);
  });
}
