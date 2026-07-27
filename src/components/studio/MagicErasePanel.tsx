import { useEffect, useState } from 'react';
import { ScanText, Eraser, Settings as SettingsIcon, Loader2, Brush } from 'lucide-react';
import { StudioPanel } from './StudioPanel';
import type { TextRegion } from '../../lib/textDetect';

interface MagicErasePanelProps {
  regions: TextRegion[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  minConfidence: number;
  onMinConfidenceChange: (value: number) => void;
  detecting: boolean;
  detectProgress: number;
  onDetect: () => void;
  fillColor: string;
  onFillColorChange: (color: string) => void;
  onFillRegions: (ids: string[], color: string) => void;
  serverConfigured: boolean;
  erasing: boolean;
  onSendToMagicErase: (ids: string[]) => void;
  onJumpToRegion?: (region: TextRegion) => void;
  onOpenSettings?: () => void;
  /** Manual masking: draw with the Magic Erase rail tool (paints a mask, Quick-Mask-style) or with
   *  any selection tool (Lasso/Marquee/Magic Wand), then send whatever's currently selected. */
  hasManualSelection: boolean;
  onSendSelectionToMagicErase: () => void;
  onArmMagicEraseTool: () => void;
  magicEraseToolArmed: boolean;
}

export function MagicErasePanel({
  regions, selectedIds, onToggleSelect, onSelectAll, onSelectNone,
  minConfidence, onMinConfidenceChange, detecting, detectProgress, onDetect,
  fillColor, onFillColorChange, onFillRegions,
  serverConfigured, erasing, onSendToMagicErase, onJumpToRegion, onOpenSettings,
  hasManualSelection, onSendSelectionToMagicErase, onArmMagicEraseTool, magicEraseToolArmed,
}: MagicErasePanelProps) {
  const [busyRegionId, setBusyRegionId] = useState<string | null>(null);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const selectedList = regions.filter(r => selectedIds.has(r.id));
  const busy = detecting || erasing;

  // Picking the Magic Erase tool straight from the rail (not this panel's own "Paint a Mask"
  // button) should still land on the right tab — otherwise arming it from the rail while the panel
  // sat on "Text detection" would leave the paint/send controls the user needs off-screen.
  useEffect(() => {
    if (magicEraseToolArmed) setMode('manual');
  }, [magicEraseToolArmed]);

  return (
    <StudioPanel title="Magic Erase">
      {!serverConfigured && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 text-micro text-ink-faint hover:text-ink"
        >
          <SettingsIcon size={12} /> Set a Magic Erase server in Settings first
        </button>
      )}

      {/* One-click switch between the two ways of marking an area — each renders its own section
          below rather than both staying stacked and visible, so switching means "click the other
          tab" instead of hunting through an always-long panel. */}
      <div className="grid grid-cols-2 gap-1 p-1 rounded-control bg-ink/5 border border-hairline">
        <button
          type="button"
          onClick={() => setMode('auto')}
          className={`h-7 rounded-control text-micro font-medium transition-colors flex items-center justify-center gap-1.5 ${
            mode === 'auto' ? 'bg-accent-soft text-accent shadow-control' : 'text-ink-faint hover:text-ink'
          }`}
        >
          <ScanText size={13} /> Auto Detect
        </button>
        <button
          type="button"
          onClick={() => { setMode('manual'); if (!magicEraseToolArmed) onArmMagicEraseTool(); }}
          className={`h-7 rounded-control text-micro font-medium transition-colors flex items-center justify-center gap-1.5 ${
            mode === 'manual' ? 'bg-accent-soft text-accent shadow-control' : 'text-ink-faint hover:text-ink'
          }`}
        >
          <Brush size={13} /> Manual Draw
        </button>
      </div>

      {mode === 'manual' ? (
        <div className="flex flex-col gap-2">
          <p className="text-micro text-ink-faint/70 leading-snug">
            Paint over the area with the Magic Erase tool, or select it with Lasso / Marquee / Magic Wand,
            then send it below.
          </p>
          <button
            type="button"
            onClick={onArmMagicEraseTool}
            disabled={busy}
            className={`studio-interactive h-8 rounded-control text-ui font-medium border transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
              magicEraseToolArmed ? 'bg-accent-soft border-accent text-accent' : 'border-hairline bg-ink/5 text-ink hover:bg-ink/10'
            }`}
          >
            <Brush size={14} /> {magicEraseToolArmed ? 'Painting Mask…' : 'Paint a Mask'}
          </button>
          <button
            type="button"
            disabled={busy || !serverConfigured || !hasManualSelection}
            onClick={onSendSelectionToMagicErase}
            className="studio-interactive h-8 rounded-control text-ui font-medium bg-accent text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {erasing ? <><Loader2 size={14} className="animate-spin" /> Erasing…</> : <><Eraser size={14} /> Send Drawn Mask to Magic Erase</>}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-micro text-ink-faint/70 leading-snug">
            Detect text locally, then fill each block with a flat color yourself or send it to your
            Magic Erase server for AI inpainting.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="flex items-center justify-between text-micro text-ink-faint">
              <span>Ignore below confidence</span>
              <span className="tabular-nums">{minConfidence}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minConfidence}
              onChange={(e) => onMinConfidenceChange(Number(e.target.value))}
              className="accent-[var(--color-accent)]"
            />
          </div>

          <button
            type="button"
            onClick={onDetect}
            disabled={busy}
            className="studio-interactive h-8 rounded-control text-ui font-medium border border-hairline bg-ink/5 text-ink hover:bg-ink/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {detecting
              ? <><Loader2 size={14} className="animate-spin" /> Scanning… {Math.round(detectProgress * 100)}%</>
              : <><ScanText size={14} /> Detect Text</>}
          </button>

          {regions.length > 0 && (
            <>
              <div className="flex items-center justify-between text-micro text-ink-faint">
                <span>{regions.length} block{regions.length === 1 ? '' : 's'} · {selectedList.length} selected</span>
                <span className="flex gap-2">
                  <button type="button" className="hover:text-ink" onClick={onSelectAll}>All</button>
                  <button type="button" className="hover:text-ink" onClick={onSelectNone}>None</button>
                </span>
              </div>

              <div className="flex flex-col gap-1 max-h-52 overflow-y-auto border border-hairline rounded-control p-1.5">
                {regions.map(region => (
                  <div
                    key={region.id}
                    className="flex items-center gap-2 px-1.5 py-1 rounded-control hover:bg-ink/5 group"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(region.id)}
                      onChange={() => onToggleSelect(region.id)}
                    />
                    <button
                      type="button"
                      onClick={() => onJumpToRegion?.(region)}
                      className="flex-1 min-w-0 text-left text-micro text-ink truncate"
                      title={region.text}
                    >
                      {region.text}
                    </button>
                    <span className="text-[10px] text-ink-faint tabular-nums shrink-0">{Math.round(region.confidence)}%</span>
                    <input
                      type="color"
                      value={fillColor}
                      title="Fill this block"
                      onChange={(e) => {
                        setBusyRegionId(region.id);
                        onFillRegions([region.id], e.target.value);
                        setBusyRegionId(null);
                      }}
                      disabled={busy}
                      className={`w-5 h-5 rounded border border-hairline bg-transparent shrink-0 opacity-0 group-hover:opacity-100 ${busyRegionId === region.id ? 'opacity-100' : ''} transition-opacity`}
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <span className="text-micro text-ink-faint shrink-0">Fill color</span>
                <input
                  type="color"
                  value={fillColor}
                  onChange={(e) => onFillColorChange(e.target.value)}
                  className="flex-1 h-7 rounded-control border border-hairline bg-transparent"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy || selectedList.length === 0}
                  onClick={() => onFillRegions(selectedList.map(r => r.id), fillColor)}
                  className="studio-interactive h-8 rounded-control text-ui font-medium border border-hairline bg-ink/5 text-ink hover:bg-ink/10 transition-colors disabled:opacity-50"
                >
                  Fill Selected
                </button>
                <button
                  type="button"
                  disabled={busy || regions.length === 0}
                  onClick={() => onFillRegions(regions.map(r => r.id), fillColor)}
                  className="studio-interactive h-8 rounded-control text-ui font-medium border border-hairline bg-ink/5 text-ink hover:bg-ink/10 transition-colors disabled:opacity-50"
                >
                  Fill All
                </button>
              </div>

              <div className="border-t border-hairline pt-3 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={busy || !serverConfigured || selectedList.length === 0}
                  onClick={() => onSendToMagicErase(selectedList.map(r => r.id))}
                  className="studio-interactive h-8 rounded-control text-ui font-medium bg-accent text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {erasing ? <><Loader2 size={14} className="animate-spin" /> Erasing…</> : <><Eraser size={14} /> Send Selected to Magic Erase</>}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </StudioPanel>
  );
}
