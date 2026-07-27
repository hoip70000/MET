/**
 * Local (in-browser) OCR text detection, backed by tesseract.js — dynamically imported (see
 * CLAUDE.md's dynamic-import convention) since it pulls in a wasm OCR engine + language data,
 * nothing this size belongs in the main bundle. "Local" means recognition runs client-side rather
 * than being sent to a server, matching what Magic Erase's OCR panel needs: find text without
 * extracting/sending the image anywhere.
 */
export interface TextRegion {
  id: string;
  text: string;
  /** 0-100, tesseract's own line-level confidence. */
  confidence: number;
  /** Page-image-space pixel bounds. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectTextOptions {
  /** Lines below this confidence are dropped — "ignore low-accuracy texts". Default 60. */
  minConfidence?: number;
  langs?: string;
  onProgress?: (progress: number) => void;
}

export async function detectTextRegions(
  source: HTMLCanvasElement,
  options: DetectTextOptions = {},
): Promise<TextRegion[]> {
  const { minConfidence = 60, langs = 'eng', onProgress } = options;
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(langs, undefined, {
    logger: onProgress ? (m) => { if (m.status === 'recognizing text') onProgress(m.progress); } : undefined,
  });

  try {
    const { data } = await worker.recognize(source, {}, { blocks: true });
    const regions: TextRegion[] = [];
    let i = 0;
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const text = line.text.trim();
          if (!text) continue;
          if (line.confidence < minConfidence) continue;
          const { x0, y0, x1, y1 } = line.bbox;
          if (x1 <= x0 || y1 <= y0) continue;
          regions.push({
            id: `ocr-${i++}`,
            text,
            confidence: line.confidence,
            x: x0,
            y: y0,
            width: x1 - x0,
            height: y1 - y0,
          });
        }
      }
    }
    return regions;
  } finally {
    await worker.terminate();
  }
}
