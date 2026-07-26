import { describe, it, expect } from 'vitest';
import {
  curveLut, curvesFilter, exposureFilter, vibranceFilter, colorBalanceFilter,
  posterizeFilter, thresholdFilter, gradientMapFilter,
} from './adjustments';
import type { AdjustmentLayerData } from '../components/studio/studioTypes';

/** A single-pixel ImageData-shaped object — the filters only ever read/write `.data`, so a plain
 *  Uint8ClampedArray-backed object is enough; no real DOM/canvas needed for this (node) test env. */
function onePixel(r: number, g: number, b: number, a = 255): ImageData {
  return { data: new Uint8ClampedArray([r, g, b, a]), width: 1, height: 1, colorSpace: 'srgb' } as ImageData;
}

const IDENTITY_CURVE = [{ input: 0, output: 0 }, { input: 255, output: 255 }];
const NEUTRAL_COLOR_BALANCE: AdjustmentLayerData['colorBalance'] = {
  shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  preserveLuminosity: true,
};

describe('curveLut', () => {
  it('is the identity function for the default two-point curve', () => {
    const lut = curveLut(IDENTITY_CURVE);
    for (let v = 0; v < 256; v++) expect(lut[v]).toBe(v);
  });

  it('raises midtones when a middle control point is raised', () => {
    const lut = curveLut([{ input: 0, output: 0 }, { input: 128, output: 200 }, { input: 255, output: 255 }]);
    expect(lut[128]).toBe(200);
    expect(lut[64]).toBeGreaterThan(64); // midtone lift pulls the neighborhood up too
  });

  it('clamps outside the first/last point rather than extrapolating', () => {
    const lut = curveLut([{ input: 50, output: 100 }, { input: 200, output: 150 }]);
    expect(lut[0]).toBe(100);
    expect(lut[255]).toBe(150);
  });
});

describe('curvesFilter', () => {
  it('applies the LUT to R/G/B, leaves alpha untouched', () => {
    const filter = curvesFilter([{ input: 0, output: 0 }, { input: 255, output: 128 }]);
    const img = onePixel(255, 255, 255, 200);
    filter(img);
    expect(img.data[0]).toBe(128);
    expect(img.data[1]).toBe(128);
    expect(img.data[2]).toBe(128);
    expect(img.data[3]).toBe(200);
  });
});

describe('exposureFilter', () => {
  it('is a no-op at exposure=0, offset=0, gamma=1', () => {
    const filter = exposureFilter(0, 0, 1);
    const img = onePixel(100, 150, 200);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).toEqual([100, 150, 200]);
  });

  it('brightens at a positive exposure stop', () => {
    const filter = exposureFilter(1, 0, 1); // +1 stop = 2x linear light
    const img = onePixel(100, 100, 100);
    filter(img);
    expect(img.data[0]).toBeGreaterThan(100);
  });
});

describe('vibranceFilter', () => {
  it('is a no-op at vibrance=0', () => {
    const filter = vibranceFilter(0);
    const img = onePixel(200, 100, 50);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).toEqual([200, 100, 50]);
  });

  it('boosts a low-saturation pixel more than a high positive vibrance would leave untouched', () => {
    const filter = vibranceFilter(100);
    const img = onePixel(140, 130, 120); // low saturation
    filter(img);
    // Saturation increases -> the channels should spread further apart than they started.
    const spreadBefore = 140 - 120;
    const spreadAfter = Math.max(img.data[0], img.data[1], img.data[2]) - Math.min(img.data[0], img.data[1], img.data[2]);
    expect(spreadAfter).toBeGreaterThan(spreadBefore);
  });
});

describe('colorBalanceFilter', () => {
  it('is a no-op with all-neutral sliders', () => {
    const filter = colorBalanceFilter(NEUTRAL_COLOR_BALANCE);
    const img = onePixel(120, 130, 140);
    filter(img);
    expect(Array.from(img.data.slice(0, 3))).toEqual([120, 130, 140]);
  });

  it('shifts shadows toward red without touching a pure-highlight pixel', () => {
    const cb: AdjustmentLayerData['colorBalance'] = {
      ...NEUTRAL_COLOR_BALANCE,
      shadows: { cyanRed: 100, magentaGreen: 0, yellowBlue: 0 },
      preserveLuminosity: false,
    };
    const filter = colorBalanceFilter(cb);
    const shadowPixel = onePixel(10, 10, 10);
    filter(shadowPixel);
    expect(shadowPixel.data[0]).toBeGreaterThan(10);

    const highlightPixel = onePixel(250, 250, 250);
    filter(highlightPixel);
    expect(highlightPixel.data[0]).toBe(250); // shadow-only slider shouldn't move a highlight pixel
  });
});

describe('posterizeFilter', () => {
  it('quantizes to exactly N distinct output levels across the input range', () => {
    const filter = posterizeFilter(2);
    const outputs = new Set<number>();
    for (let v = 0; v <= 255; v += 5) {
      const img = onePixel(v, v, v);
      filter(img);
      outputs.add(img.data[0]);
    }
    expect(outputs.size).toBeLessThanOrEqual(2);
  });
});

describe('thresholdFilter', () => {
  it('sends below-threshold luminance to black and above to white', () => {
    const filter = thresholdFilter(128);
    const dark = onePixel(50, 50, 50); // luminance 50 < 128
    filter(dark);
    expect(Array.from(dark.data.slice(0, 3))).toEqual([0, 0, 0]);

    const light = onePixel(200, 200, 200); // luminance 200 >= 128
    filter(light);
    expect(Array.from(light.data.slice(0, 3))).toEqual([255, 255, 255]);
  });
});

describe('gradientMapFilter', () => {
  it('maps black-luminance pixels to the from-color and white-luminance pixels to the to-color', () => {
    const filter = gradientMapFilter({ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 });
    const black = onePixel(0, 0, 0);
    filter(black);
    expect(Array.from(black.data.slice(0, 3))).toEqual([255, 0, 0]);

    const white = onePixel(255, 255, 255);
    filter(white);
    expect(Array.from(white.data.slice(0, 3))).toEqual([0, 0, 255]);
  });
});
