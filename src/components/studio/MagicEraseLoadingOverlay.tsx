import { Sparkles } from 'lucide-react';

interface MagicEraseLoadingOverlayProps {
  label?: string;
}

/**
 * Covers the canvas viewport while a Magic Erase request is in flight. Reuses this app's existing
 * `.liquid-glass-heavy` material (see index.css) rather than inventing a second glass recipe, plus
 * a diagonal sheen sweep so it reads as "processing", not just "frosted and stuck".
 */
export function MagicEraseLoadingOverlay({ label = 'Erasing with AI…' }: MagicEraseLoadingOverlayProps) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center liquid-glass-heavy overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(115deg, transparent 30%, color-mix(in srgb, white 22%, transparent) 48%, transparent 66%)',
          animation: 'splashShimmer 1.8s ease-in-out infinite',
        }}
      />
      <div className="relative flex flex-col items-center gap-3 px-6 py-5 rounded-panel">
        <Sparkles size={28} className="text-accent animate-pulse" />
        <span className="text-ui font-medium text-ink">{label}</span>
        <div className="w-40 h-1 rounded-full bg-ink/10 overflow-hidden">
          <div
            className="h-full w-1/3 rounded-full bg-accent"
            style={{ animation: 'splashShimmer 1.2s ease-in-out infinite' }}
          />
        </div>
      </div>
    </div>
  );
}
