import { useEffect, useRef } from 'react';
import { hsvToRgb } from './colorConversions';

interface SvSquareProps {
  hue: number;
  sat: number;
  val: number;
  onPick: (sat: number, val: number) => void;
  size?: number;
}

/**
 * The saturation/brightness picker square, shared by ColorPanel's inline Color Wheel mode (small)
 * and ColorPickerModal's full dialog (large) — a single implementation so the canvas-draw and
 * pointer-pick logic can't drift into two copies of the same math.
 */
export function SvSquare({ hue, sat, val, onPick, size = 160 }: SvSquareProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { r, g, b } = hsvToRgb({ h: hue, s: 100, v: 100 });
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, size, size);
    const whiteGrad = ctx.createLinearGradient(0, 0, size, 0);
    whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
    whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = whiteGrad;
    ctx.fillRect(0, 0, size, size);
    const blackGrad = ctx.createLinearGradient(0, 0, 0, size);
    blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
    blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = blackGrad;
    ctx.fillRect(0, 0, size, size);
  }, [hue, size]);

  function handlePick(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * 100;
    const v = 100 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) * 100;
    onPick(s, v);
  }

  return (
    <div className="relative" style={{ width: size, aspectRatio: '1 / 1' }}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="w-full h-full rounded-control border border-hairline cursor-crosshair"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePick(e); }}
        onPointerMove={(e) => { if (e.buttons === 1) handlePick(e); }}
      />
      <div
        className="absolute w-3 h-3 rounded-full border-2 border-white pointer-events-none -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${sat}%`, top: `${100 - val}%`, boxShadow: '0 0 0 1px rgba(0,0,0,0.6)' }}
      />
    </div>
  );
}
