import { describe, it, expect } from 'vitest';
import {
  boxBlurFilter, gaussianBlurFilter, motionBlurFilter, unsharpMaskFilter,
  addNoiseFilter, mosaicFilter, findEdgesFilter, embossFilter,
} from './filters';

/** A plain Uint8ClampedArray-backed object shaped like ImageData — no real DOM/canvas needed for
 *  this (node) test env, matching adjustments.test.ts's own fixture convention. */
function makeImage(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function flatImage(width: number, height: number, r: number, g: number, b: number): ImageData {
  return makeImage(width, height, () => [r, g, b, 255]);
}

function pixelAt(imageData: ImageData, x: number, y: number): [number, number, number, number] {
  const i = (y * imageData.width + x) * 4;
  const d = imageData.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

describe('boxBlurFilter', () => {
  it('leaves a perfectly flat image unchanged', () => {
    const img = flatImage(9, 9, 120, 60, 200);
    boxBlurFilter(3)(img);
    expect(pixelAt(img, 4, 4)).toEqual([120, 60, 200, 255]);
  });

  it('is a no-op at radius 0', () => {
    const img = makeImage(5, 5, (x, y) => [x * 10, y * 10, 0, 255]);
    const before = new Uint8ClampedArray(img.data);
    boxBlurFilter(0)(img);
    expect(img.data).toEqual(before);
  });

  it('spreads a single bright pixel into its dark neighbors', () => {
    const img = makeImage(9, 9, (x, y) => (x === 4 && y === 4 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    boxBlurFilter(2)(img);
    // The bright center dims (averaged with dark neighbors) and an adjacent dark pixel brightens.
    expect(pixelAt(img, 4, 4)[0]).toBeLessThan(255);
    expect(pixelAt(img, 4, 4)[0]).toBeGreaterThan(0);
    expect(pixelAt(img, 5, 4)[0]).toBeGreaterThan(0);
  });
});

describe('gaussianBlurFilter', () => {
  it('leaves a perfectly flat image unchanged', () => {
    const img = flatImage(11, 11, 80, 80, 80);
    gaussianBlurFilter(4)(img);
    expect(pixelAt(img, 5, 5)).toEqual([80, 80, 80, 255]);
  });

  it('softens a hard vertical edge, pulling the boundary column toward the average of both sides', () => {
    const img = makeImage(20, 5, (x) => (x < 10 ? [0, 0, 0, 255] : [200, 200, 200, 255]));
    gaussianBlurFilter(6)(img);
    const boundary = pixelAt(img, 10, 2)[0];
    expect(boundary).toBeGreaterThan(0);
    expect(boundary).toBeLessThan(200);
  });
});

describe('motionBlurFilter', () => {
  it('is a no-op at distance 0', () => {
    const img = makeImage(6, 6, (x, y) => [x * 20, y * 20, 0, 255]);
    const before = new Uint8ClampedArray(img.data);
    motionBlurFilter(0, 0)(img);
    expect(img.data).toEqual(before);
  });

  it('smears a single bright column horizontally along a 0deg direction, bounded by the distance', () => {
    const img = makeImage(11, 5, (x) => (x === 5 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    motionBlurFilter(0, 6)(img);
    expect(pixelAt(img, 5, 2)[0]).toBeLessThan(255);
    expect(pixelAt(img, 3, 2)[0]).toBeGreaterThan(0);
    // Distance 6 -> a ±3px reach; column 0 (5px away) is outside it and stays untouched.
    expect(pixelAt(img, 0, 2)[0]).toBe(0);
  });
});

describe('unsharpMaskFilter', () => {
  it('leaves flat regions untouched below the threshold', () => {
    const img = flatImage(9, 9, 100, 100, 100);
    unsharpMaskFilter(2, 3, 10)(img);
    expect(pixelAt(img, 4, 4)).toEqual([100, 100, 100, 255]);
  });

  it('increases contrast across an edge beyond the original step', () => {
    const img = makeImage(20, 5, (x) => (x < 10 ? [50, 50, 50, 255] : [200, 200, 200, 255]));
    unsharpMaskFilter(2, 4, 0)(img);
    // The dark side should get darker and/or the light side lighter right at the boundary —
    // sharpening exaggerates the step rather than smoothing it.
    const darkSide = pixelAt(img, 9, 2)[0];
    const lightSide = pixelAt(img, 10, 2)[0];
    expect(lightSide - darkSide).toBeGreaterThan(150 - 1); // original step was exactly 150
  });
});

describe('addNoiseFilter', () => {
  it('is a no-op at amount 0, regardless of distribution', () => {
    const img = flatImage(6, 6, 128, 64, 32);
    const before = new Uint8ClampedArray(img.data);
    addNoiseFilter(0, 'uniform', false)(img);
    expect(img.data).toEqual(before);
  });

  it('leaves the alpha channel alone', () => {
    const img = flatImage(4, 4, 128, 128, 128);
    addNoiseFilter(50, 'gaussian', true)(img);
    expect(pixelAt(img, 2, 2)[3]).toBe(255);
  });

  it('applies the same per-pixel offset to every channel when monochromatic', () => {
    const img = flatImage(4, 4, 128, 128, 128);
    addNoiseFilter(80, 'uniform', true)(img);
    const [r, g, b] = pixelAt(img, 1, 1);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
});

describe('mosaicFilter', () => {
  it('is the identity at cell size 1', () => {
    const img = makeImage(4, 4, (x, y) => [x * 10, y * 10, 0, 255]);
    const before = new Uint8ClampedArray(img.data);
    mosaicFilter(1)(img);
    expect(img.data).toEqual(before);
  });

  it('flattens a cell to the average of its pixels', () => {
    // A 4x2 image, left half black, right half white — one 4x2 cell should average to mid-grey.
    const img = makeImage(4, 2, (x) => (x < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    mosaicFilter(4)(img);
    expect(pixelAt(img, 0, 0)[0]).toBe(128); // (0*2 + 255*2) / 4, rounded
    expect(pixelAt(img, 0, 0)).toEqual(pixelAt(img, 3, 1)); // whole cell is now one flat colour
  });
});

describe('findEdgesFilter', () => {
  it('reads as flat white where there is no gradient at all', () => {
    const img = flatImage(9, 9, 90, 90, 90);
    findEdgesFilter()(img);
    expect(pixelAt(img, 4, 4)).toEqual([255, 255, 255, 255]);
  });

  it('darkens at a hard edge', () => {
    const img = makeImage(9, 9, (x) => (x < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    findEdgesFilter()(img);
    expect(pixelAt(img, 4, 4)[0]).toBeLessThan(255);
  });
});

describe('embossFilter', () => {
  it('reads as flat mid-grey where there is no gradient at all', () => {
    const img = flatImage(9, 9, 200, 10, 60);
    embossFilter(45, 2, 1)(img);
    expect(pixelAt(img, 4, 4)).toEqual([128, 128, 128, 255]);
  });

  it('pushes away from mid-grey across a hard edge', () => {
    const img = makeImage(11, 11, (x) => (x < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    embossFilter(0, 2, 1)(img);
    expect(pixelAt(img, 5, 5)[0]).not.toBe(128);
  });
});
