import type { MenuDef, MenuItemDef } from '../studio/menu/menuDefinitions';

const LINE_SPACINGS = [1, 1.15, 1.5, 2];

export interface TextEditorMenuActions {
  newDoc: () => void;
  closeDoc: () => void;
  saveNow: () => void;
  openVersionHistory: () => void;
  exportTxt: () => void;
  exportDocx: () => void;
  printPdf: () => void;
  sendToTyper: () => void;

  undo: () => void;
  redo: () => void;
  openFind: () => void;
  openFindReplace: () => void;
  runSpellCheck: () => void;

  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  toggleDir: () => void;
  isRtl: boolean;

  /** `document.execCommand` wrapper, shared with the toolbar buttons — same mechanism, just a
   *  second way to trigger it. */
  exec: (command: string, value?: string) => void;
  applyLineSpacing: (value: number) => void;
  insertTable: () => void;
  insertImage: () => void;
  insertFileAttachment: () => void;
  insertHardBreak: () => void;
  showShortcuts: () => void;
}

/** Six menus (File/Edit/View/Format/Insert/Help), built the same way Studio's own
 *  `buildMenus`/`MenuActions` are — reusing `Menu`/`MenuBar` directly rather than a second menu
 *  component, since both are already fully generic and props-driven. */
export function buildTextEditorMenus(a: TextEditorMenuActions): MenuDef[] {
  const sep = (id: string): MenuItemDef => ({ id, label: '', separator: true });

  return [
    {
      id: 'file',
      label: 'File',
      items: [
        { id: 'new', label: 'New Document', shortcut: 'Ctrl+N', action: a.newDoc },
        { id: 'close', label: 'Close Document', action: a.closeDoc },
        sep('sep1'),
        { id: 'save', label: 'Save Now', shortcut: 'Ctrl+S', action: a.saveNow },
        { id: 'versions', label: 'Version History…', action: a.openVersionHistory },
        sep('sep2'),
        {
          id: 'export',
          label: 'Export',
          submenu: [
            { id: 'export-txt', label: 'Plain Text (.txt)', action: a.exportTxt },
            { id: 'export-docx', label: 'Word Document (.docx)', action: a.exportDocx },
            { id: 'export-pdf', label: 'PDF (Print)…', action: a.printPdf },
          ],
        },
        sep('sep3'),
        { id: 'send', label: 'Send to TypeR', shortcut: 'Alt+Shift+S', action: a.sendToTyper },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', action: a.undo },
        { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Y', action: a.redo },
        sep('sep1'),
        { id: 'find', label: 'Find', shortcut: 'Ctrl+F', action: a.openFind },
        { id: 'find-replace', label: 'Find & Replace', shortcut: 'Ctrl+H', action: a.openFindReplace },
        sep('sep2'),
        { id: 'spell', label: 'Spell Check', action: a.runSpellCheck },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        { id: 'zoom-in', label: 'Zoom In', shortcut: 'Ctrl+=', action: a.zoomIn },
        { id: 'zoom-out', label: 'Zoom Out', shortcut: 'Ctrl+-', action: a.zoomOut },
        { id: 'zoom-reset', label: 'Actual Size', shortcut: 'Ctrl+0', action: a.zoomReset },
        sep('sep1'),
        { id: 'dir', label: 'Right to Left', checked: a.isRtl, action: a.toggleDir },
      ],
    },
    {
      id: 'format',
      label: 'Format',
      items: [
        { id: 'bold', label: 'Bold', shortcut: 'Ctrl+B', action: () => a.exec('bold') },
        { id: 'italic', label: 'Italic', shortcut: 'Ctrl+I', action: () => a.exec('italic') },
        { id: 'underline', label: 'Underline', shortcut: 'Ctrl+U', action: () => a.exec('underline') },
        { id: 'strike', label: 'Strikethrough', shortcut: 'Ctrl+Shift+X', action: () => a.exec('strikeThrough') },
        sep('sep1'),
        { id: 'h1', label: 'Heading 1', shortcut: 'Ctrl+Alt+1', action: () => a.exec('formatBlock', 'H1') },
        { id: 'h2', label: 'Heading 2', shortcut: 'Ctrl+Alt+2', action: () => a.exec('formatBlock', 'H2') },
        { id: 'h3', label: 'Heading 3', shortcut: 'Ctrl+Alt+3', action: () => a.exec('formatBlock', 'H3') },
        { id: 'h4', label: 'Heading 4', shortcut: 'Ctrl+Alt+4', action: () => a.exec('formatBlock', 'H4') },
        { id: 'p', label: 'Normal', shortcut: 'Ctrl+0', action: () => a.exec('formatBlock', 'P') },
        sep('sep2'),
        {
          id: 'align',
          label: 'Align',
          submenu: [
            { id: 'align-left', label: 'Left', shortcut: 'Ctrl+Shift+L', action: () => a.exec('justifyLeft') },
            { id: 'align-center', label: 'Center', shortcut: 'Ctrl+Shift+E', action: () => a.exec('justifyCenter') },
            { id: 'align-right', label: 'Right', shortcut: 'Ctrl+Shift+R', action: () => a.exec('justifyRight') },
            { id: 'align-justify', label: 'Justify', shortcut: 'Ctrl+Shift+J', action: () => a.exec('justifyFull') },
          ],
        },
        {
          id: 'line-spacing',
          label: 'Line Spacing',
          submenu: LINE_SPACINGS.map(v => ({ id: `ls-${v}`, label: `${v}`, action: () => a.applyLineSpacing(v) })),
        },
        { id: 'indent', label: 'Increase Indent', shortcut: 'Ctrl+]', action: () => a.exec('indent') },
        { id: 'outdent', label: 'Decrease Indent', shortcut: 'Ctrl+[', action: () => a.exec('outdent') },
      ],
    },
    {
      id: 'insert',
      label: 'Insert',
      items: [
        { id: 'table', label: 'Table…', action: a.insertTable },
        { id: 'image', label: 'Image…', action: a.insertImage },
        { id: 'attachment', label: 'File Attachment…', action: a.insertFileAttachment },
        { id: 'break', label: 'Page Break', shortcut: 'Ctrl+Enter', action: a.insertHardBreak },
        sep('sep1'),
        { id: 'ul', label: 'Bulleted List', shortcut: 'Ctrl+Shift+8', action: () => a.exec('insertUnorderedList') },
        { id: 'ol', label: 'Numbered List', shortcut: 'Ctrl+Shift+7', action: () => a.exec('insertOrderedList') },
        { id: 'hr', label: 'Horizontal Rule', action: () => a.exec('insertHorizontalRule') },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { id: 'shortcuts', label: 'Keyboard Shortcuts', action: a.showShortcuts },
      ],
    },
  ];
}
