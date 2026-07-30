/** Pure DOM helpers for the Text Editor's table support — no React, so the
 *  structural logic (row/column/table add-delete, cell navigation) stays
 *  testable independent of any component, matching this codebase's
 *  layerTree.ts/pathGeometry.ts convention of keeping structural logic
 *  DOM-manipulation-only and framework-free. Tables live purely as `<table>`
 *  HTML inside a page's content string — there is no separate table data
 *  model, mirroring how every other formatting concern in this editor works. */

const CELL_STYLE = 'border:1px solid rgba(120,120,120,0.6);padding:4px 8px;min-width:40px;';

function makeCell(): HTMLTableCellElement {
  const td = document.createElement('td');
  td.setAttribute('style', CELL_STYLE);
  td.innerHTML = '<br>';
  return td;
}

export function insertTableHtml(rows: number, cols: number): string {
  const cell = `<td style="${CELL_STYLE}"><br></td>`;
  const row = `<tr>${cell.repeat(Math.max(1, cols))}</tr>`;
  return `<table data-te-table="1" style="border-collapse:collapse;width:100%;">${row.repeat(Math.max(1, rows))}</table><p><br></p>`;
}

export function findEnclosingTable(node: Node | null): HTMLTableElement | null {
  let el: Node | null = node;
  while (el) {
    if (el instanceof HTMLTableElement) return el;
    el = el.parentNode;
  }
  return null;
}

export function findEnclosingCell(node: Node | null): HTMLTableCellElement | null {
  let el: Node | null = node;
  while (el) {
    if (el instanceof HTMLTableCellElement) return el;
    el = el.parentNode;
  }
  return null;
}

function cellIndexInRow(cell: HTMLTableCellElement): number {
  return Array.from(cell.parentElement?.children ?? []).indexOf(cell);
}

export function addRow(table: HTMLTableElement, referenceRow: HTMLTableRowElement, position: 'above' | 'below'): HTMLTableRowElement {
  const colCount = referenceRow.children.length;
  const newRow = document.createElement('tr');
  for (let i = 0; i < colCount; i++) newRow.appendChild(makeCell());
  const body = referenceRow.parentElement;
  if (position === 'above') {
    body?.insertBefore(newRow, referenceRow);
  } else {
    body?.insertBefore(newRow, referenceRow.nextSibling);
  }
  return newRow;
}

export function addColumn(table: HTMLTableElement, colIndex: number, position: 'left' | 'right'): void {
  const insertAt = position === 'left' ? colIndex : colIndex + 1;
  table.querySelectorAll('tr').forEach((row) => {
    const ref = row.children[insertAt] ?? null;
    row.insertBefore(makeCell(), ref);
  });
}

export interface CaretRestorePoint {
  parent: Node;
  nextSibling: Node | null;
}

export function deleteTable(table: HTMLTableElement): CaretRestorePoint | null {
  const parent = table.parentNode;
  if (!parent) return null;
  const nextSibling = table.nextSibling;
  table.remove();
  return { parent, nextSibling };
}

/** Removes the given row; deletes the whole table instead if it was the last row. */
export function deleteRow(row: HTMLTableRowElement): CaretRestorePoint | null {
  const table = findEnclosingTable(row);
  const body = row.parentElement;
  if (!table || !body) return null;
  if (body.children.length <= 1) return deleteTable(table);
  row.remove();
  return null;
}

/** Removes the column at `colIndex` from every row; deletes the whole table
 *  instead if it was the last column. */
export function deleteColumn(table: HTMLTableElement, colIndex: number): CaretRestorePoint | null {
  const rows = table.querySelectorAll('tr');
  const colCount = rows[0]?.children.length ?? 0;
  if (colCount <= 1) return deleteTable(table);
  rows.forEach((row) => { row.children[colIndex]?.remove(); });
  return null;
}

export function restoreCaretAt(point: CaretRestorePoint): void {
  const marker = document.createTextNode('\u200b');
  point.parent.insertBefore(marker, point.nextSibling);
  const range = document.createRange();
  range.setStartAfter(marker);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Moves the caret to the next/previous cell in reading order. Tab from the
 *  last cell of the last row appends a new row and moves into its first cell. */
export function navigateCell(table: HTMLTableElement, currentCell: HTMLTableCellElement, direction: 'next' | 'prev'): boolean {
  const rows = Array.from(table.querySelectorAll('tr'));
  const rowEl = currentCell.parentElement as HTMLTableRowElement;
  const rowIdx = rows.indexOf(rowEl);
  const colIdx = cellIndexInRow(currentCell);
  const colCount = rowEl.children.length;

  let targetRowIdx = rowIdx;
  let targetColIdx = colIdx + (direction === 'next' ? 1 : -1);

  if (targetColIdx >= colCount) {
    if (rowIdx === rows.length - 1) {
      addRow(table, rowEl, 'below');
    }
    targetRowIdx = rowIdx + 1;
    targetColIdx = 0;
  } else if (targetColIdx < 0) {
    if (rowIdx === 0) return false;
    targetRowIdx = rowIdx - 1;
    const prevRow = rows[targetRowIdx];
    targetColIdx = (prevRow?.children.length ?? 1) - 1;
  }

  const freshRows = Array.from(table.querySelectorAll('tr'));
  const targetRow = freshRows[targetRowIdx];
  const targetCell = targetRow?.children[targetColIdx] as HTMLTableCellElement | undefined;
  if (!targetCell) return false;

  const range = document.createRange();
  range.selectNodeContents(targetCell);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return true;
}

export function tableColumnCount(table: HTMLTableElement): number {
  return table.querySelector('tr')?.children.length ?? 0;
}
