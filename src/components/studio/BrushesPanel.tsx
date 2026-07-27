import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Download, Star, MoreHorizontal, Search, Plus } from 'lucide-react';
import { IconButton } from '../ui';
import { cn } from '../ui/cn';
import { swal, swalToast } from '../../lib/swalTheme';
import { genId } from '../../lib/id';
import { StudioPanel } from './StudioPanel';
import { BRUSH_FOLDERS, loadBrushPresets, saveBrushPresets, type BrushPreset } from '../../lib/brushStore';
import { imageToBrushMask, maskFromDataUrl } from './paint/brushTip';
import { renderBrushThumbnail } from './paint/brushThumbnail';

interface BrushesPanelProps {
  /** Current foreground, so thumbnails render in the colour the brush will actually paint. */
  color: string;
  activeBrushId: string | null;
  onSelectBrush: (preset: BrushPreset, mask?: HTMLCanvasElement) => void;
  /** Live engine values, so edits in the panel drive the same state the options bar does. */
  live: {
    size: number; hardness: number; opacity: number; flow: number;
    spacing: number; angle: number; roundness: number; scatter: number; smoothing: number;
    pressureSize: boolean; pressureOpacity: boolean;
  };
  onLiveChange: (patch: Partial<BrushesPanelProps['live']>) => void;
  /** Set when hosted inside the right-column panel stack, whose own header already shows the name. */
  hideTitle?: boolean;
}

function Row({ label, value, min, max, step = 1, onChange, format }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <label className="flex items-center gap-2 text-micro text-ink-faint">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="studio-focusable flex-1 accent-[var(--color-accent)]"
      />
      <span className="w-10 text-right tabular-nums font-mono text-[10px] text-ink">
        {format ? format(value) : Math.round(value)}
      </span>
    </label>
  );
}

/** One brush tile: a real engine-rendered stroke thumbnail plus its name and menu. */
function BrushTile({ preset, mask, color, active, onSelect, onMenu, onToggleFav }: {
  preset: BrushPreset; mask?: HTMLCanvasElement; color: string; active: boolean;
  onSelect: () => void; onMenu: (e: React.MouseEvent) => void; onToggleFav: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) renderBrushThumbnail(ref.current, preset, color, mask);
  }, [preset, color, mask]);

  return (
    <div
      className={cn(
        'studio-interactive group relative rounded-control border overflow-hidden',
        active ? 'border-accent bg-accent-soft' : 'border-hairline bg-ink/5 hover:bg-ink/10'
      )}
    >
      <button type="button" onClick={onSelect} onContextMenu={onMenu} className="studio-focusable w-full text-left px-2 pt-1.5 pb-1">
        <canvas ref={ref} width={200} height={40} className="w-full h-[34px] block" />
        <span className={cn('block text-micro truncate mt-0.5', active ? 'text-accent font-medium' : 'text-ink/80')}>
          {preset.name}
        </span>
      </button>
      <button
        type="button"
        aria-label={preset.favorite ? `Unfavourite ${preset.name}` : `Favourite ${preset.name}`}
        onClick={onToggleFav}
        className="absolute top-1 right-6 w-5 h-5 flex items-center justify-center text-ink-faint hover:text-warning"
      >
        <Star size={11} fill={preset.favorite ? 'currentColor' : 'none'} className={preset.favorite ? 'text-warning' : ''} />
      </button>
      <button
        type="button"
        aria-label={`${preset.name} options`}
        onClick={onMenu}
        className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center text-ink-faint hover:text-ink"
      >
        <MoreHorizontal size={12} />
      </button>
    </div>
  );
}

export function BrushesPanel({ color, activeBrushId, onSelectBrush, live, onLiveChange, hideTitle }: BrushesPanelProps) {
  const [presets, setPresets] = useState<BrushPreset[]>([]);
  const [query, setQuery] = useState('');
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({ Favorites: true, Basic: true });
  /** Decoded masks for image brushes, keyed by preset id — decoded once, not per render. */
  const [masks, setMasks] = useState<Record<string, HTMLCanvasElement>>({});
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadBrushPresets().then(async (loaded) => {
      setPresets(loaded);
      const decoded: Record<string, HTMLCanvasElement> = {};
      await Promise.all(loaded.filter(p => p.tipMaskDataUrl).map(async (p) => {
        try { decoded[p.id] = await maskFromDataUrl(p.tipMaskDataUrl!); } catch { /* skip a corrupt tip */ }
      }));
      setMasks(decoded);
    });
  }, []);

  function persist(next: BrushPreset[]) {
    setPresets(next);
    void saveBrushPresets(next);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? presets.filter(p => p.name.toLowerCase().includes(q)) : presets;
  }, [presets, query]);

  // Favorites is a virtual folder — a view over the flag, not a location, so a
  // brush can be favourited without being moved out of its real folder.
  const groups = useMemo(() => {
    const out: { folder: string; items: BrushPreset[] }[] = [];
    const favs = filtered.filter(p => p.favorite);
    if (favs.length) out.push({ folder: 'Favorites', items: favs });
    const folders = [...new Set([...BRUSH_FOLDERS, ...presets.map(p => p.folder)])];
    for (const f of folders) {
      const items = filtered.filter(p => p.folder === f);
      if (items.length) out.push({ folder: f, items });
    }
    return out;
  }, [filtered, presets]);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    // Snapshot the FileList *before* resetting the input: `files` is live, so
    // clearing `value` first empties it and the import silently no-ops.
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    const added: BrushPreset[] = [];
    const newMasks: Record<string, HTMLCanvasElement> = {};
    for (const file of files) {
      try {
        const url = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('read failed'));
          fr.readAsDataURL(file);
        });
        const img = await new Promise<HTMLImageElement>((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = () => rej(new Error('decode failed'));
          i.src = url;
        });
        const mask = imageToBrushMask(img);
        const id = genId('brush');
        added.push({
          id, name: file.name.replace(/\.[^.]+$/, ''), folder: 'Imported', favorite: false,
          size: 48, hardness: 1, opacity: 1, flow: 1, spacing: 0.2, angle: 0, roundness: 1,
          scatter: 0, smoothing: 0, pressureSize: true, pressureOpacity: false,
          shape: 'image', tipMaskDataUrl: mask.toDataURL('image/png'),
        });
        newMasks[id] = mask;
      } catch {
        swalToast({ icon: 'error', title: `Couldn't import "${file.name}"` });
      }
    }
    if (added.length) {
      persist([...presets, ...added]);
      setMasks(m => ({ ...m, ...newMasks }));
      setOpenFolders(f => ({ ...f, Imported: true }));
      swalToast({ icon: 'success', title: `Imported ${added.length} brush${added.length === 1 ? '' : 'es'}` });
    }
  }

  function handleExport() {
    const custom = presets.filter(p => !p.builtin);
    if (!custom.length) {
      swalToast({ icon: 'info', title: 'No custom brushes to export' });
      return;
    }
    const blob = new Blob([JSON.stringify({ version: 1, brushes: custom }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'MET_Brushes.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function openMenu(e: React.MouseEvent, preset: BrushPreset) {
    e.preventDefault();
    e.stopPropagation();
    const result = await swal({
      title: preset.name,
      input: 'select',
      inputOptions: {
        rename: 'Rename…',
        duplicate: 'Duplicate',
        move: 'Move to folder…',
        favorite: preset.favorite ? 'Remove from Favorites' : 'Add to Favorites',
        ...(preset.builtin ? {} : { delete: 'Delete' }),
      },
      inputPlaceholder: 'Choose an action',
      showCancelButton: true,
      confirmButtonText: 'Go',
    });
    const action = result.value as string | undefined;
    if (!result.isConfirmed || !action) return;

    if (action === 'favorite') {
      persist(presets.map(p => p.id === preset.id ? { ...p, favorite: !p.favorite } : p));
      return;
    }
    if (action === 'duplicate') {
      const copy: BrushPreset = { ...preset, id: genId('brush'), name: `${preset.name} copy`, builtin: false };
      persist([...presets, copy]);
      if (masks[preset.id]) setMasks(m => ({ ...m, [copy.id]: masks[preset.id] }));
      return;
    }
    if (action === 'delete') {
      persist(presets.filter(p => p.id !== preset.id));
      return;
    }
    if (action === 'rename') {
      if (preset.builtin) { swalToast({ icon: 'info', title: 'Built-in brushes can’t be renamed — duplicate it first' }); return; }
      const r = await swal({ title: 'Rename brush', input: 'text', inputValue: preset.name, showCancelButton: true, confirmButtonText: 'Rename' });
      const name = (r.value || '').trim();
      if (r.isConfirmed && name) persist(presets.map(p => p.id === preset.id ? { ...p, name } : p));
      return;
    }
    if (action === 'move') {
      const folders = [...new Set([...BRUSH_FOLDERS, ...presets.map(p => p.folder)])];
      const r = await swal({
        title: 'Move to folder',
        input: 'select',
        inputOptions: Object.fromEntries(folders.map(f => [f, f])),
        inputValue: preset.folder,
        showCancelButton: true,
        confirmButtonText: 'Move',
      });
      if (r.isConfirmed && r.value) persist(presets.map(p => p.id === preset.id ? { ...p, folder: String(r.value) } : p));
    }
  }

  return (
    <StudioPanel
      title="Brushes"
      hideTitle={hideTitle}
      actions={
        <>
          <IconButton size="sm" aria-label="Import brushes" title="Import image(s) as brush tips" onClick={() => importRef.current?.click()} className="!bg-transparent">
            <Upload size={13} />
          </IconButton>
          <input ref={importRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImport} />
          <IconButton size="sm" aria-label="Export brushes" title="Export custom brushes as JSON" onClick={handleExport} className="!bg-transparent">
            <Download size={13} />
          </IconButton>
        </>
      }
    >
      <label className="flex items-center gap-1.5 shrink-0">
        <Search size={12} className="text-ink-faint shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brushes…"
          className="studio-focusable flex-1 bg-ink/5 border border-hairline rounded-control px-2 py-1 text-micro text-ink"
        />
      </label>

      {groups.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <Plus size={20} className="text-ink-faint/40" strokeWidth={1.5} />
          <p className="text-micro text-ink-faint">{query ? 'No brushes match that search.' : 'No brushes yet.'}</p>
        </div>
      )}

      {groups.map(({ folder, items }) => {
        const open = openFolders[folder] ?? false;
        return (
          <div key={folder} className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setOpenFolders(f => ({ ...f, [folder]: !open }))}
              className="studio-focusable flex items-center gap-1 text-[10px] text-ink-faint uppercase tracking-wide py-0.5"
            >
              <span className={cn('studio-interactive inline-block', open ? 'rotate-90' : '')}>›</span>
              {folder}
              <span className="opacity-50">({items.length})</span>
            </button>
            {open && (
              <div className="grid grid-cols-2 gap-1.5">
                {items.map(p => (
                  <BrushTile
                    key={`${folder}:${p.id}`}
                    preset={p}
                    mask={masks[p.id]}
                    color={color}
                    active={p.id === activeBrushId}
                    onSelect={() => onSelectBrush(p, masks[p.id])}
                    onMenu={(e) => openMenu(e, p)}
                    onToggleFav={() => persist(presets.map(x => x.id === p.id ? { ...x, favorite: !x.favorite } : x))}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex flex-col gap-2 pt-2 border-t border-hairline/60">
        <span className="text-[10px] text-ink-faint uppercase tracking-wide">Brush Settings</span>
        <Row label="Size" value={live.size} min={1} max={200} onChange={(v) => onLiveChange({ size: v })} />
        <Row label="Hardness" value={live.hardness * 100} min={0} max={100} onChange={(v) => onLiveChange({ hardness: v / 100 })} format={(v) => `${Math.round(v)}%`} />
        <Row label="Opacity" value={live.opacity * 100} min={0} max={100} onChange={(v) => onLiveChange({ opacity: v / 100 })} format={(v) => `${Math.round(v)}%`} />
        <Row label="Flow" value={live.flow * 100} min={0} max={100} onChange={(v) => onLiveChange({ flow: v / 100 })} format={(v) => `${Math.round(v)}%`} />
        <Row label="Spacing" value={live.spacing * 100} min={1} max={100} onChange={(v) => onLiveChange({ spacing: v / 100 })} format={(v) => `${Math.round(v)}%`} />
        <Row label="Angle" value={live.angle} min={-180} max={180} onChange={(v) => onLiveChange({ angle: v })} format={(v) => `${Math.round(v)}°`} />
        <Row label="Roundness" value={live.roundness * 100} min={5} max={100} onChange={(v) => onLiveChange({ roundness: v / 100 })} format={(v) => `${Math.round(v)}%`} />
        <Row label="Scatter" value={live.scatter * 100} min={0} max={100} onChange={(v) => onLiveChange({ scatter: v / 100 })} format={(v) => `${Math.round(v)}%`} />
        <Row label="Smoothing" value={live.smoothing * 100} min={0} max={100} onChange={(v) => onLiveChange({ smoothing: v / 100 })} format={(v) => `${Math.round(v)}%`} />
        <div className="flex items-center gap-3 pt-0.5">
          <label className="flex items-center gap-1.5 text-micro text-ink-faint">
            <input type="checkbox" checked={live.pressureSize} onChange={(e) => onLiveChange({ pressureSize: e.target.checked })} className="accent-[var(--color-accent)]" />
            Pressure → size
          </label>
          <label className="flex items-center gap-1.5 text-micro text-ink-faint">
            <input type="checkbox" checked={live.pressureOpacity} onChange={(e) => onLiveChange({ pressureOpacity: e.target.checked })} className="accent-[var(--color-accent)]" />
            → opacity
          </label>
        </div>
      </div>
    </StudioPanel>
  );
}
