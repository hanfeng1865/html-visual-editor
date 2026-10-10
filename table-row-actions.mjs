export function tableRowContext(element) {
  const table = element?.closest('table');
  if (!table) return null;
  const body = element.closest('tbody') || table.tBodies[0];
  if (!body) return null;
  const candidate = element.closest('tr');
  const row = candidate?.parentElement === body ? candidate : null;
  const template = row || [...body.rows].at(-1);
  if (!template) return null;
  const index = row ? [...body.rows].indexOf(row) + 1 : body.rows.length;
  return { body, row, template, index };
}

export function blankTableRow(source) {
  const row = source.cloneNode(true);
  for (const cell of row.cells) cell.replaceChildren();
  return row;
}

export function tableColumnContext(element) {
  const table = element?.closest('table');
  if (!table) return null;
  const rows = [...table.rows];
  if (!rows.length) return null;
  const count = Math.max(...rows.map(row => [...row.cells].reduce((width, cell) => width + (cell.colSpan || 1), 0)));
  if (!count || rows.some(row => [...row.cells].some(cell => (cell.rowSpan || 1) !== 1))) return null;
  const cell = element.closest('td,th');
  const selected = cell && rows.includes(cell.parentElement)
    ? [...cell.parentElement.cells].slice(0,cell.cellIndex).reduce((width, previous) => width + (previous.colSpan || 1), 0)
    : null;
  return { table, rows, index: selected === null ? count : selected + (cell.colSpan || 1), selected };
}

export function blankTableCell(source) {
  const cell = source.cloneNode(true);
  cell.replaceChildren();
  return cell;
}

export function columnInsertTarget(row, column) {
  let start = 0;
  for (const [index,cell] of [...row.cells].entries()) {
    const end = start + (cell.colSpan || 1);
    if (start < column && column < end) return { spanCell: cell };
    if (column === end) return { index:index+1, source:cell };
    if (column <= start) return { index, source: cell };
    start = end;
  }
  return { index: row.cells.length, source: row.cells[row.cells.length-1] || null };
}

export function columnDeleteTarget(row, column) {
  let start = 0;
  for (const cell of row.cells) {
    const end = start + (cell.colSpan || 1);
    if (start <= column && column < end) return (cell.colSpan || 1) > 1 ? { spanCell: cell } : { cell };
    start = end;
  }
  return null;
}

// Store original logical indices so later deletions and regenerated rows agree.
export function columnDeletionRule(context, previous=[]) {
  let index=context.selected;
  for(const removed of [...previous].sort((a,b)=>a.index-b.index))if(removed.index<=index)index++;
  const reference=context.rows.find(row=>[...row.cells].every(cell=>cell.colSpan===1)) || context.rows[0];
  let start=0,width=0;
  for(const cell of reference.cells) {
    const span=cell.colSpan || 1;
    if(start<=context.selected && context.selected<start+span)width=cell.getBoundingClientRect().width/span;
    start+=span;
  }
  return {index,width};
}

// Convert only complete old column deletions; isolated cell deletions stay intact.
export function migrateColumnDeletions(patches,doc,sourceDoc,selectorFor) {
  const groups=new Map();
  for(const [key,patch] of Object.entries(patches))if(patch.deleted) {
    let cell;try{cell=doc.querySelector(patch.selector);}catch{continue;}
    if(!cell?.matches('td,th') || cell.colSpan!==1)continue;
    const context=tableColumnContext(cell);if(!context || context.selected===null)continue;
    if(!groups.has(context.table))groups.set(context.table,new Map());
    const columns=groups.get(context.table);
    if(!columns.has(context.selected))columns.set(context.selected,[]);
    columns.get(context.selected).push({key,cell,context});
  }
  let next=patches,migrated=0;
  for(const [table,columns] of groups) {
    const selector=selectorFor(table),existing=Object.entries(next).find(([,patch])=>patch.selector===selector);
    let source;try{source=[...sourceDoc.querySelectorAll(selector)];}catch{continue;}
    if(source.length!==1 || source[0].tagName!=='TABLE' || existing?.[1].tableColumns)continue;
    const complete=[...columns.values()].filter(items=>items.some(item=>item.cell.tagName==='TH')
      && items.length===table.rows.length && [...table.rows].every(row=>items.some(item=>item.cell.parentElement===row))
      && items.some(item=>next[item.key].ai?.fields?.deleted));
    if(!complete.length)continue;
    if(next===patches)next=structuredClone(patches);
    const rules=complete.map(items=>columnDeletionRule(items[0].context));
    function removeField(key,field,property) {
      const patch=next[key];if(!patch)return;
      if(property){delete patch[field]?.[property];if(Object.keys(patch[field]||{}).length)return;}
      delete patch[field];delete patch.ai?.fields?.[field];
      if(patch.ai && !Object.keys(patch.ai.fields).length)delete patch.ai;
      if(Object.keys(patch).every(name=>['selector','ai'].includes(name)))delete next[key];
    }
    for(const items of complete)for(const {key} of items)removeField(key,'deleted');
    // Earlier deletion actions also wrote geometry. Replace those automatic
    // adjustments with the rule, without dropping unrelated style edits.
    const view=doc.defaultView,total=rules.reduce((sum,rule)=>sum+rule.width,0);
    for(const [key,patch] of Object.entries(next))if(patch.styles) {
      let node;try{node=doc.querySelector(patch.selector);}catch{continue;}
      if(node!==table && node?.closest('table')!==table)continue;
      const computed=view.getComputedStyle(node);
      if(node===table)for(const property of ['minWidth','width']) {
        const original=property==='width'?node.style.width:computed.minWidth;
        if(original.endsWith('px') && patch.styles?.[property]===Math.max(0,parseFloat(original)-total)+'px')removeField(key,'styles',property);
      }
      else if(node.matches('td,th') && computed.position==='sticky') {
        const context=tableColumnContext(node);if(!context)continue;
        for(const [property,affected] of [['left',rules.filter(rule=>rule.index<context.selected)],['right',rules.filter(rule=>rule.index>=context.index)]]) {
          const original=computed[property],width=affected.reduce((sum,rule)=>sum+rule.width,0);
          if(width && original.endsWith('px') && patch.styles?.[property]===Math.max(0,parseFloat(original)-width)+'px')removeField(key,'styles',property);
        }
      }
    }
    const key=existing?.[0] || 'table-columns:'+selector;
    next[key]={...next[key],selector,tableColumns:rules};migrated+=rules.length;
  }
  return {patches:next,migrated};
}

// Capture layout before removing cells. Keep these changes in the same history
// entry as the deletion so preview, source saving and undo share one result.
export function columnDeleteChanges(context) {
  const {table,rows,selected}=context;
  const view=table.ownerDocument.defaultView;
  const changes=[];
  const reference=rows.find(row=>[...row.cells].every(cell=>cell.colSpan===1)) || rows[0];
  let column=0,removedWidth=0;
  for(const cell of reference.cells) {
    const span=cell.colSpan || 1;
    if(column<=selected && selected<column+span)removedWidth=cell.getBoundingClientRect().width/span;
    column+=span;
  }
  for(const row of rows) {
    const target=columnDeleteTarget(row,selected);
    if(target?.cell)changes.push({element:target.cell,deleted:true});
    else if(target?.spanCell)changes.push({element:target.spanCell,attributes:{colspan:String(target.spanCell.colSpan-1)}});
    let start=0;
    for(const cell of row.cells) {
      const span=cell.colSpan || 1,end=start+span;
      const computed=view.getComputedStyle(cell),styles={};
      if(cell!==target?.cell && computed.position==='sticky') {
        if(start>selected && computed.left.endsWith('px') && parseFloat(computed.left)>0)
          styles.left=Math.max(0,parseFloat(computed.left)-removedWidth)+'px';
        if(end<=selected && computed.right.endsWith('px') && parseFloat(computed.right)>0)
          styles.right=Math.max(0,parseFloat(computed.right)-removedWidth)+'px';
      }
      if(Object.keys(styles).length)changes.push({element:cell,styles});
      start=end;
    }
  }
  // A <col span="n"> (or a childless <colgroup>) represents n logical columns.
  let start=0;
  for(const group of [...table.children].filter(node=>node.tagName==='COLGROUP')) {
    const columns=group.children.length?[...group.children].filter(node=>node.tagName==='COL'):[group];
    for(const col of columns) {
      const span=col.span || 1;
      if(start<=selected && selected<start+span)changes.push(span>1
        ? {element:col,attributes:{span:String(span-1)}} : {element:col,deleted:true});
      start+=span;
    }
  }
  const computed=view.getComputedStyle(table),styles={};
  if(computed.minWidth.endsWith('px') && parseFloat(computed.minWidth)>0)
    styles.minWidth=Math.max(0,parseFloat(computed.minWidth)-removedWidth)+'px';
  if(table.style.width.endsWith('px'))styles.width=Math.max(0,parseFloat(table.style.width)-removedWidth)+'px';
  if(Object.keys(styles).length)changes.push({element:table,styles});
  return changes;
}

export function columnMovePlan(element,offset) {
  const context=tableColumnContext(element);
  if(!context || context.selected===null || ![-1,1].includes(offset))return null;
  const {table,rows,selected}=context,next=selected+offset;
  if(next<0)return null;
  const orders=[],changes=[],view=table.ownerDocument.defaultView;
  function swap(parent,a,b) {
    const children=[...parent.children],ai=children.indexOf(a),bi=children.indexOf(b);
    [children[ai],children[bi]]=[children[bi],children[ai]];
    orders.push({parent,children});
  }
  for(const row of rows) {
    const a=columnDeleteTarget(row,selected),b=columnDeleteTarget(row,next);
    // A header/footer spanning both columns still covers the same range.
    if(a?.spanCell && a.spanCell===b?.spanCell)continue;
    if(!a?.cell || !b?.cell)return null;
    const sourceWidth=a.cell.getBoundingClientRect().width,targetWidth=b.cell.getBoundingClientRect().width;
    for(const [cell,delta] of [[a.cell,offset*targetWidth],[b.cell,-offset*sourceWidth]]) {
      const computed=view.getComputedStyle(cell),styles={width:computed.width};
      if(computed.position==='sticky') {
        if(computed.left.endsWith('px'))styles.left=Math.max(0,parseFloat(computed.left)+delta)+'px';
        if(computed.right.endsWith('px'))styles.right=Math.max(0,parseFloat(computed.right)-delta)+'px';
      }
      changes.push({element:cell,styles});
    }
    swap(row,a.cell,b.cell);
  }
  const columns=[];
  for(const group of [...table.children].filter(node=>node.tagName==='COLGROUP')) {
    const cols=group.children.length?[...group.children].filter(node=>node.tagName==='COL'):[group];
    for(const col of cols)for(let i=0;i<(col.span||1);i++)columns.push(col);
  }
  if(columns.length) {
    const a=columns[selected],b=columns[next];
    if(!a || !b)return null;
    if(a!==b) {
      if((a.span||1)!==1 || (b.span||1)!==1 || a.parentElement!==b.parentElement || a.tagName!=='COL' || b.tagName!=='COL')return null;
      for(const col of [a,b])changes.push({element:col,styles:{width:view.getComputedStyle(col).width}});
      swap(a.parentElement,a,b);
    }
  }
  return {orders,changes};
}
