// Rich document editing keeps the existing Markdown storage and history format.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const bodyIcon = name => `<img src="./assets/requirements/${name}.svg" alt="" aria-hidden="true">`;
export function documentOutline(text) {
  const headings = [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)];
  const level = headings.some(h => h[1].length === 2) ? 2 : 3;
  return headings.filter(h => h[1].length === level).map((h, index) => ({
    title:h[2], index, start:h.index,
    end:headings.find(next => next.index > h.index && next[1].length <= level)?.index ?? text.length
  }));
}
export function removeDocumentSection(text, index) {
  const section=documentOutline(text)[index];
  if(!section)return text;
  return text.slice(0,section.start).trimEnd() + (section.end<text.length?'\n\n'+text.slice(section.end):'');
}
export function richDocument(text, markdown) {
  let index = 0;
  const level = /^##\s/m.test(text) ? 2 : 3;
  return markdown(text).replace(new RegExp(`<h${level}>`, 'g'), () => `<h${level} id="req-section-${index++}">`);
}
export function editorToolbar(button, sourceMode) {
  const format = (command, label, title) => `<button type="button" data-format="${command}" aria-label="${title}" title="${title}">${label}</button>`;
  return `<div class="req-body-toolbar"><select aria-label="正文样式" data-body-style ${sourceMode?'disabled':''}><option value="p">正文</option><option value="h1">文档标题</option><option value="h2">章节标题</option><option value="h3">小节标题</option></select><span class="req-tool-divider"></span>${format('bold','<b>B</b>','加粗')}${format('italic','<i>I</i>','斜体')}${format('underline','<u>U</u>','下划线')}<span class="req-tool-divider"></span>${format('insertUnorderedList',bodyIcon('list'),'无序列表')}${format('insertOrderedList',bodyIcon('list-ordered'),'有序列表')}<span class="req-toolbar-space"></span>${button('undo-doc',bodyIcon('undo')).replace('<button ', '<button aria-label="撤销文档修改" title="撤销文档修改" ')}${button('redo-doc',bodyIcon('redo')).replace('<button ', '<button aria-label="重做" title="重做" ')}${button('body-source',sourceMode?'正文视图':'Markdown')}</div>`;
}
export function outlinePanel(it, text, selectedSection) {
  const sections = documentOutline(text);
  const questions = it.questions || [];
  const qText = q => typeof q === 'string' ? q : q.text || q.question || q.title || '';
  return `<aside class="req-body-outline"><div class="req-outline-title"><h3>需求目录</h3><button type="button" data-action="add-section">${bodyIcon('plus')}添加章节</button></div><nav aria-label="需求目录">${sections.map(s=>`<div class="req-outline-row ${selectedSection===s.index?'selected':''}"><button type="button" data-body-section="${s.index}" aria-current="${selectedSection===s.index}"><span>${String(s.index+1).padStart(2,'0')}</span><strong>${escape(s.title.replace(/^\d+[.、\s]+/,''))}</strong></button><button type="button" class="req-section-delete" data-delete-section="${s.index}" title="删除此章节及正文，可撤销" aria-label="删除章节：${escape(s.title)}">${bodyIcon('trash')}</button></div>`).join('')||'<p class="req-outline-empty">添加章节后，目录会显示在这里。</p>'}</nav><section class="req-outline-pending"><h3>待确认事项 <span>${questions.length}</span></h3>${questions.slice(0,8).map((q,i)=>`<button type="button" data-body-question="${i}"><i></i><span>${escape(qText(q))}</span></button>`).join('')||'<p>暂无待确认事项</p>'}</section></aside>`;
}
export function editableMarkdown(root) {
  const inline = node => {
    if(node.nodeType === 3)return node.textContent.replace(/\u00a0/g,' ');
    const text = [...node.childNodes].map(inline).join('');
    const tag = node.nodeName.toLowerCase();
    if(tag==='br')return '\n';
    if(['strong','b'].includes(tag))return `**${text}**`;
    if(['em','i'].includes(tag))return `*${text}*`;
    if(tag==='u'||node.style?.textDecoration?.includes('underline'))return `<u>${text}</u>`;
    if(tag==='code')return '`'+text+'`';
    if(tag==='a')return `[${text}](${node.getAttribute('href')||''})`;
    return text;
  };
  const block = node => {
    const tag=node.nodeName.toLowerCase();
    if(!node.textContent.trim()&&tag!=='table')return '';
    if(/^h[1-6]$/.test(tag))return '#'.repeat(Number(tag[1]))+' '+inline(node);
    if(tag==='ul'||tag==='ol')return [...node.children].map((li,i)=>(tag==='ol'?`${i+1}. `:'- ')+inline(li)).join('\n');
    if(tag==='table'){
      const rows=[...node.querySelectorAll('tr')].map(row=>'| '+[...row.children].map(inline).join(' | ')+' |');
      if(rows.length)rows.splice(1,0,'| '+[...node.querySelector('tr').children].map(()=>'---').join(' | ')+' |');
      return rows.join('\n');
    }
    if(tag==='div'&&[...node.children].some(el=>/^(DIV|P|H[1-6]|UL|OL|TABLE)$/.test(el.tagName)))return [...node.childNodes].map(block).join('\n\n');
    return inline(node);
  };
  return [...root.childNodes].map(block).filter(value=>value.trim()).join('\n\n').replace(/\n{3,}/g,'\n\n').trim();
}
