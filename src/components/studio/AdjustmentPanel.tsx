import { StudioPanel } from './StudioPanel';
import { ADJUSTMENT_KIND_LABEL, type AdjustmentKind, type AdjustmentLayerData, type StudioLayer } from './studioTypes';
import { CurvesEditor } from './CurvesEditor';

interface AdjustmentPanelProps {
  layer: StudioLayer;
  onUpdate: (id: string, patch: Partial<AdjustmentLayerData>) => void;
  /** Set when hosted inside the right-column panel stack, whose own header already shows the name. */
  hideTitle?: boolean;
}

const KIND_LABELS = ADJUSTMENT_KIND_LABEL;

function Slider({ label, min, max, step = 1, value, onChange }: {
  label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-micro text-ink-faint">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[var(--color-accent)]"
      />
      <span className="w-10 text-right tabular-nums">{value}</span>
    </label>
  );
}

export function AdjustmentPanel({ layer, onUpdate, hideTitle }: AdjustmentPanelProps) {
  const data = layer.adjustment;
  if (!data) return null;

  const set = (patch: Partial<AdjustmentLayerData>) => onUpdate(layer.id, patch);
  const setLevels = (patch: Partial<AdjustmentLayerData['levels']>) => set({ levels: { ...data.levels, ...patch } });

  return (
    <StudioPanel title="Adjustment" hideTitle={hideTitle}>
        <p className="text-micro text-ink-faint/70 leading-snug">
          Applies to every layer below this one. Move it up or down the stack to change what it affects,
          or lower its opacity to ease it off.
        </p>

        <label className="flex flex-col gap-1 text-micro text-ink-faint">
          <span>Type</span>
          <select
            value={data.kind}
            onChange={(e) => set({ kind: e.target.value as AdjustmentKind })}
            className="studio-interactive bg-ink/5 border border-hairline rounded-control px-2 py-1.5 text-ink text-micro"
          >
            {(Object.keys(KIND_LABELS) as AdjustmentKind[]).map(k => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </label>

        {data.kind === 'brightness-contrast' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Brightness" min={-100} max={100} value={data.brightness} onChange={(v) => set({ brightness: v })} />
            <Slider label="Contrast" min={-100} max={100} value={data.contrast} onChange={(v) => set({ contrast: v })} />
          </div>
        )}

        {data.kind === 'hue-saturation' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Hue" min={-180} max={180} value={data.hue} onChange={(v) => set({ hue: v })} />
            <Slider label="Saturation" min={-100} max={100} value={data.saturation} onChange={(v) => set({ saturation: v })} />
            <Slider label="Lightness" min={-100} max={100} value={data.lightness} onChange={(v) => set({ lightness: v })} />
          </div>
        )}

        {data.kind === 'levels' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="In black" min={0} max={254} value={data.levels.inBlack} onChange={(v) => setLevels({ inBlack: Math.min(v, data.levels.inWhite - 1) })} />
            <Slider label="In white" min={1} max={255} value={data.levels.inWhite} onChange={(v) => setLevels({ inWhite: Math.max(v, data.levels.inBlack + 1) })} />
            <Slider label="Gamma" min={0.1} max={9.99} step={0.01} value={data.levels.gamma} onChange={(v) => setLevels({ gamma: v })} />
            <Slider label="Out black" min={0} max={254} value={data.levels.outBlack} onChange={(v) => setLevels({ outBlack: Math.min(v, data.levels.outWhite - 1) })} />
            <Slider label="Out white" min={1} max={255} value={data.levels.outWhite} onChange={(v) => setLevels({ outWhite: Math.max(v, data.levels.outBlack + 1) })} />
          </div>
        )}

        {data.kind === 'curves' && (
          <CurvesEditor points={data.curves.rgb} onChange={(rgb) => set({ curves: { rgb } })} />
        )}

        {data.kind === 'exposure' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Exposure" min={-20} max={20} step={0.1} value={data.exposure} onChange={(v) => set({ exposure: v })} />
            <Slider label="Offset" min={-0.5} max={0.5} step={0.01} value={data.exposureOffset} onChange={(v) => set({ exposureOffset: v })} />
            <Slider label="Gamma" min={0.1} max={9.99} step={0.01} value={data.exposureGamma} onChange={(v) => set({ exposureGamma: v })} />
          </div>
        )}

        {data.kind === 'vibrance' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Vibrance" min={-100} max={100} value={data.vibrance} onChange={(v) => set({ vibrance: v })} />
          </div>
        )}

        {data.kind === 'color-balance' && (
          <div className="flex flex-col gap-3 pt-1">
            {(['shadows', 'midtones', 'highlights'] as const).map(range => (
              <div key={range} className="flex flex-col gap-1.5">
                <span className="text-micro text-ink-faint capitalize">{range}</span>
                <Slider
                  label="Cyan-Red" min={-100} max={100} value={data.colorBalance[range].cyanRed}
                  onChange={(v) => set({ colorBalance: { ...data.colorBalance, [range]: { ...data.colorBalance[range], cyanRed: v } } })}
                />
                <Slider
                  label="Magenta-Green" min={-100} max={100} value={data.colorBalance[range].magentaGreen}
                  onChange={(v) => set({ colorBalance: { ...data.colorBalance, [range]: { ...data.colorBalance[range], magentaGreen: v } } })}
                />
                <Slider
                  label="Yellow-Blue" min={-100} max={100} value={data.colorBalance[range].yellowBlue}
                  onChange={(v) => set({ colorBalance: { ...data.colorBalance, [range]: { ...data.colorBalance[range], yellowBlue: v } } })}
                />
              </div>
            ))}
            <label className="flex items-center gap-2 text-micro text-ink-faint">
              <input
                type="checkbox"
                checked={data.colorBalance.preserveLuminosity}
                onChange={(e) => set({ colorBalance: { ...data.colorBalance, preserveLuminosity: e.target.checked } })}
              />
              Preserve luminosity
            </label>
          </div>
        )}

        {data.kind === 'posterize' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Levels" min={2} max={255} value={data.posterizeLevels} onChange={(v) => set({ posterizeLevels: v })} />
          </div>
        )}

        {data.kind === 'threshold' && (
          <div className="flex flex-col gap-2 pt-1">
            <Slider label="Threshold" min={0} max={255} value={data.threshold} onChange={(v) => set({ threshold: v })} />
          </div>
        )}

        {data.kind === 'gradient-map' && (
          <div className="flex flex-col gap-2 pt-1">
            <div
              className="h-6 rounded-control border border-hairline"
              style={{ background: `linear-gradient(to right, ${data.gradientMap.from}, ${data.gradientMap.to})` }}
            />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-micro text-ink-faint flex-1">
                <span className="w-8 shrink-0">From</span>
                <input
                  type="color"
                  value={data.gradientMap.from}
                  onChange={(e) => set({ gradientMap: { ...data.gradientMap, from: e.target.value } })}
                  className="flex-1 h-7 rounded-control border border-hairline bg-transparent"
                />
              </label>
              <label className="flex items-center gap-2 text-micro text-ink-faint flex-1">
                <span className="w-8 shrink-0">To</span>
                <input
                  type="color"
                  value={data.gradientMap.to}
                  onChange={(e) => set({ gradientMap: { ...data.gradientMap, to: e.target.value } })}
                  className="flex-1 h-7 rounded-control border border-hairline bg-transparent"
                />
              </label>
            </div>
          </div>
        )}
    </StudioPanel>
  );
}
