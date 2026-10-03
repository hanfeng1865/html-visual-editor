import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const privateNames=new Set(['.git','.editor-workspaces','.visual-editor','.visual-editor-backups','.source-history','node_modules','editor-config.json','ai-config.json','visual-edits.json','change-annotations.json','.DS_Store','coverage','playwright-report','test-results']);
const credentialPatterns=[/sk-[A-Za-z0-9_-]{20,}/,/(?:ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{20,}/,/AKIA[A-Z0-9]{16}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
const git=args=>execFileSync('git',args,{maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});

async function shareSource() {
  const root=git(['rev-parse','--show-toplevel']).toString().trim();
  const revision=git(['rev-parse','HEAD']).toString().trim();
  const output=resolve(process.argv[2]||'html-editor-source.zip');
  let localKey='';
  try {
    const config=JSON.parse(await readFile(join(root,'.editor-workspaces','ai-config.json'),'utf8'));
    if(typeof config.apiKey==='string')localKey=config.apiKey.trim();
  } catch(error) {if(error.code!=='ENOENT')throw new Error('无法读取本机密钥配置，已停止打包。');}
  const entries=git(['ls-tree','-rz','--full-tree',revision]).toString().split('\0').filter(Boolean);
  const paths=[];
  for(const entry of entries) {
    const separator=entry.indexOf('\t');
    const [mode,type,object]=entry.slice(0,separator).split(' ');
    const name=entry.slice(separator+1);
    if(name.split('/').some(part=>privateNames.has(part)||part.startsWith('.env')&&part!=='.env.example')||/\.(zip|log|pem|key|p12|pfx)$/i.test(name))continue;
    if(mode==='120000'||type!=='blob')throw new Error(`无法安全打包链接或子模块：${name}`);
    const content=git(['cat-file','blob',object]).toString();
    if(localKey&&content.includes(localKey)||credentialPatterns.some(pattern=>pattern.test(content)))throw new Error(`发现疑似密钥，已停止打包：${name}（不显示密钥内容）`);
    paths.push(name);
  }
  if(!paths.length)throw new Error('没有可分享的已提交源码。');
  const archive=git(['archive','--format=zip',revision,'--',...paths.map(name=>`:(literal)${name}`)]);
  await writeFile(output,archive,{flag:'wx'});
  console.log(`已安全打包 ${paths.length} 个已提交文件：${output}\n不包含未提交修改、本机配置或 Git 历史；密钥扫描不能替代人工检查。`);
}

shareSource().catch(error=>{
  console.error(error.code==='EEXIST'?'目标文件已存在，为避免覆盖已停止打包。':error.message.startsWith('Command failed')?'Git 打包失败，请确认已安装 Git 且项目有提交记录。':error.message);
  process.exitCode=1;
});
