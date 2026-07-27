import {
  gaussianBlurFilter, motionBlurFilter, boxBlurFilter, unsharpMaskFilter,
  addNoiseFilter, mosaicFilter, findEdgesFilter, embossFilter,
} from '../../../lib/filters';

export interface FilterControlSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  default: number;
  unit?: string;
}

export interface FilterConfig {
  id: string;
  title: string;
  controls: FilterControlSpec[];
  /** `params` carries every control's current value, keyed by `FilterControlSpec.key`. Boolean
   *  controls (Monochromatic, distribution) pack into 0/1 the same way the sliders do — one flat
   *  numeric params bag keeps FilterDialog generic instead of a switch per filter's control shape. */
  run: (imageData: ImageData, params: Record<string, number>) => void;
}

/** One config per real Image > Apply Filter item — keyed by the same id `menuDefinitions.ts`'s
 *  APPLY_FILTER_SUBMENU already uses, so wiring an item up is just a lookup. Liquify isn't here: it
 *  opens the existing real brush-driven tool instead of a dialog (Studio.tsx's `switchToLiquify`). */
export const FILTER_DIALOG_CONFIGS: Record<string, FilterConfig> = {
  'gaussian-blur': {
    id: 'gaussian-blur',
    title: 'Gaussian Blur',
    controls: [
      { key: 'radius', label: 'Radius', min: 0, max: 250, step: 1, default: 8, unit: 'px' },
    ],
    run: (imageData, p) => gaussianBlurFilter(p.radius)(imageData),
  },
  'motion-blur': {
    id: 'motion-blur',
    title: 'Motion Blur',
    controls: [
      { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, default: 0, unit: '°' },
      { key: 'distance', label: 'Distance', min: 0, max: 200, step: 1, default: 20, unit: 'px' },
    ],
    run: (imageData, p) => motionBlurFilter(p.angle, p.distance)(imageData),
  },
  'box-blur': {
    id: 'box-blur',
    title: 'Box Blur',
    controls: [
      { key: 'radius', label: 'Radius', min: 0, max: 250, step: 1, default: 8, unit: 'px' },
    ],
    run: (imageData, p) => boxBlurFilter(p.radius)(imageData),
  },
  'unsharp-mask': {
    id: 'unsharp-mask',
    title: 'Unsharp Mask',
    controls: [
      { key: 'amount', label: 'Amount', min: 0, max: 300, step: 1, default: 100, unit: '%' },
      { key: 'radius', label: 'Radius', min: 0.1, max: 50, step: 0.1, default: 2, unit: 'px' },
      { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, default: 0, unit: 'levels' },
    ],
    // The UI's 0–300% reads more like Photoshop's own Amount slider than a raw 0–3 multiplier.
    run: (imageData, p) => unsharpMaskFilter(p.amount / 100, p.radius, p.threshold)(imageData),
  },
  'add-noise': {
    id: 'add-noise',
    title: 'Add Noise',
    controls: [
      { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: 12, unit: '%' },
      { key: 'gaussian', label: 'Gaussian distribution', min: 0, max: 1, step: 1, default: 0 },
      { key: 'monochromatic', label: 'Monochromatic', min: 0, max: 1, step: 1, default: 0 },
    ],
    run: (imageData, p) => addNoiseFilter(p.amount, p.gaussian ? 'gaussian' : 'uniform', !!p.monochromatic)(imageData),
  },
  mosaic: {
    id: 'mosaic',
    title: 'Mosaic',
    controls: [
      { key: 'cellSize', label: 'Cell Size', min: 1, max: 200, step: 1, default: 10, unit: 'px' },
    ],
    run: (imageData, p) => mosaicFilter(p.cellSize)(imageData),
  },
  'find-edges': {
    id: 'find-edges',
    title: 'Find Edges',
    controls: [],
    run: (imageData) => findEdgesFilter()(imageData),
  },
  emboss: {
    id: 'emboss',
    title: 'Emboss',
    controls: [
      { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, default: 135, unit: '°' },
      { key: 'height', label: 'Height', min: 1, max: 20, step: 1, default: 3, unit: 'px' },
      { key: 'amount', label: 'Amount', min: 1, max: 10, step: 0.1, default: 2, unit: '%' },
    ],
    run: (imageData, p) => embossFilter(p.angle, p.height, p.amount)(imageData),
  },
};
