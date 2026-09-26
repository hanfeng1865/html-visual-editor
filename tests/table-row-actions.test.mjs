import test from 'node:test';
import assert from 'node:assert/strict';
import { tableRowContext, blankTableRow, tableColumnContext, blankTableCell, columnInsertTarget, columnDeleteTarget } from '../table-row-actions.mjs';

test('a selected body cell adds after its row and can delete that row', () => {
  const first = {}, second = {};
  const body = { rows: [first, second] };
  first.parentElement = body;
  second.parentElement = body;
  const table = { tBodies: [body] };
  const cell = { closest: selector => ({ table, tbody: body, tr: first })[selector] || null };

  assert.deepEqual(tableRowContext(cell), { body, row: first, template: first, index: 1 });
});

test('selecting a header or table adds after the last body row without a delete target', () => {
  const last = {};
  const body = { rows: [last] };
  const table = { tBodies: [body] };
  const header = { parentElement: {}, closest: selector => ({ table, tr: header })[selector] || null };
  const selectedTable = { closest: selector => selector === 'table' ? table : null };

  assert.deepEqual(tableRowContext(header), { body, row: null, template: last, index: 1 });
  assert.deepEqual(tableRowContext(selectedTable), { body, row: null, template: last, index: 1 });
});

test('new row keeps its cells and styling while clearing copied content', () => {
  const source = {
    cloneNode(deep) {
      assert.equal(deep, true);
      return { cells: [
        { className: 'number', textContent: '01', replaceChildren() { this.textContent = ''; } },
        { className: 'detail', textContent: 'existing value', replaceChildren() { this.textContent = ''; } },
      ] };
    },
  };
  const row = blankTableRow(source);
  assert.deepEqual(row.cells.map(cell => [cell.className, cell.textContent]), [['number', ''], ['detail', '']]);
});

test('a selected cell identifies the same column across header and body rows', () => {
  const header = { cells: [{}, {}] };
  const body = { cells: [{}, {}] };
  const table = { rows: [header, body] };
  const cell = { cellIndex: 0, parentElement: body, closest: selector => ({ table, 'td,th': cell })[selector] || null };
  assert.deepEqual(tableColumnContext(cell), { table, rows: [header, body], index: 1, selected: 0 });
});

test('rows with different cell counts still allow adding a column', () => {
  const table = { rows: [{ cells: [{}, {}, {}] }, { cells: [{}, {}] }] };
  const selectedTable = { closest: selector => selector === 'table' ? table : null };
  assert.deepEqual(tableColumnContext(selectedTable), { table, rows: table.rows, index: 3, selected: null });
});

test('merged cells contribute their full width to the column position', () => {
  const table = { rows: [{ cells: [{}, {}] }, { cells: [{}, {}] }] };
  const selectedTable = { closest: selector => selector === 'table' ? table : null };
  assert.deepEqual(tableColumnContext(selectedTable), { table, rows: table.rows, index: 2, selected: null });
  table.rows[0].cells[0].colSpan = 2;
  assert.deepEqual(tableColumnContext(selectedTable), { table, rows: table.rows, index: 3, selected: null });
  assert.deepEqual(columnInsertTarget(table.rows[0], 1), { spanCell: table.rows[0].cells[0] });
  assert.deepEqual(columnDeleteTarget(table.rows[0], 1), { spanCell: table.rows[0].cells[0] });
});

test('new column cells preserve the original cell tag and style but start empty', () => {
  const source = {
    cloneNode(deep) {
      assert.equal(deep, true);
      return { tagName: 'TH', className: 'column-title', textContent: 'Title', replaceChildren() { this.textContent = ''; } };
    },
  };
  const cell = blankTableCell(source);
  assert.deepEqual([cell.tagName, cell.className, cell.textContent], ['TH', 'column-title', '']);
});
