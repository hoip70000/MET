export type TyperInsertMode = 'replace' | 'append' | 'insert-line';

export interface TyperSendRequest {
  chapterId: string;
  text: string;
  mode: TyperInsertMode;
}

/** Combines an incoming Send-to-TypeR text with a chapter's existing TypeR script, per `mode`.
 *  Shared by both bridge paths the Send-to-TypeR dialog can take — Studio.tsx's live
 *  `pendingTyperScript` effect (target chapter is the one currently open in Studio, `atLine` comes
 *  from Studio's own live `typerIndex`) and App.tsx's direct `studioProjectStore`
 *  read-modify-write (target chapter isn't open, so there's no live cursor and `atLine` is never
 *  passed) — so the three modes can't drift between the two paths. */
export function applyTyperInsertMode(existing: string, incoming: string, mode: TyperInsertMode, atLine?: number): string {
  if (mode === 'replace') return incoming;
  if (mode === 'append') return existing.length > 0 ? `${existing}\n${incoming}` : incoming;

  const lines = existing.length > 0 ? existing.split('\n') : [];
  const index = Math.max(0, Math.min(atLine ?? 0, lines.length));
  lines.splice(index, 0, incoming);
  return lines.join('\n');
}
