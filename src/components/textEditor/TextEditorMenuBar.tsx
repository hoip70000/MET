import { MenuBar } from '../studio/menu/MenuBar';
import { buildTextEditorMenus, type TextEditorMenuActions } from './textEditorMenuDefinitions';

/** Thin wrapper around Studio's own generic `MenuBar`/`Menu` — both are already fully
 *  props-driven with no Studio-specific coupling, so this reuses them directly instead of
 *  building a second multi-level menu component. */
export function TextEditorMenuBar({ actions }: { actions: TextEditorMenuActions }) {
  return <MenuBar menus={buildTextEditorMenus(actions)} />;
}
