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
