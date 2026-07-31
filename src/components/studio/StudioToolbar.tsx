import { Home, Maximize2, Minimize2, PanelLeft, PanelRight, MessageSquareText, Radio, Users, FileText } from 'lucide-react';
import { IconButton } from '../ui';
import type { WorkflowStage } from './WorkflowBar';

interface StudioToolbarProps {
  chapterName: string;
  showCleaned: boolean;
  onToggleCleaned: () => void;
  overlayOpacity: number;
  onOverlayOpacityChange: (opacity: number) => void;
  onFit: () => void;
  onBack: () => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  hasCleaned: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Chapter → Page → ... → Export pipeline pills, folded into this same row to cut down on
   *  stacked chrome bars above the canvas — see WorkflowBar.tsx for what each stage means. */
  workflowStages: WorkflowStage[];
  /** Type Region: while armed, clicking inside any selection (or drawing a new marquee/lasso/wand
   *  one) turns it straight into a text container — a separate, freehand extension of the TypeR
   *  panel's own scripted workflow, not a replacement for it. */
  typeRegionArmed: boolean;
  onToggleTypeRegion: () => void;
  /** Live collab (spectator mode): host-only "Go Live"/"End Live Session" toggle. Undefined when
   *  going live isn't available for this mount at all (e.g. a read-only viewer session). */
  isLive?: boolean;
  goingLive?: boolean;
  liveViewerCount?: number;
  onToggleLive?: () => void;
  /** Opens the Text Editor tab with a doc linked to this chapter — the Text Editor's only entry
   *  point now; it's no longer a top-level nav destination (see navTabs.ts). */
  onOpenTextEditor?: () => void;
}

export function StudioToolbar({
  chapterName, showCleaned, onToggleCleaned, overlayOpacity, onOverlayOpacityChange,
  onFit, onBack, onToggleLeftSidebar, onToggleRightSidebar, hasCleaned, isFullscreen, onToggleFullscreen, workflowStages,
  typeRegionArmed, onToggleTypeRegion, isLive, goingLive, liveViewerCount = 0, onToggleLive, onOpenTextEditor,
}: StudioToolbarProps) {
  return (
    <div className="liquid-glass-bar flex items-center gap-2 px-2.5 sm:px-4 h-12 shrink-0 border-b border-hairline">
      <IconButton size="sm" aria-label="Return home" title="Return home" onClick={onBack} className="!bg-transparent !border-0 shrink-0 max-lg:!w-11 max-lg:!h-11">
        <Home size={16} />
      </IconButton>

      <IconButton size="sm" aria-label="Toggle pages panel" title="Pages" onClick={onToggleLeftSidebar} className="!bg-transparent shrink-0 max-lg:!w-11 max-lg:!h-11">
        <PanelLeft size={15} />
      </IconButton>

      <span className="hidden md:inline text-title font-display font-semibold text-ink truncate max-w-[10rem] shrink-0">
        {chapterName}
      </span>

      <div className="w-px h-6 bg-hairline mx-1 shrink-0 hidden sm:block" />

      <button
        onClick={onToggleCleaned}
        disabled={!hasCleaned}
        className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-control border border-hairline bg-ink/5 text-ui font-medium text-ink disabled:opacity-40 disabled:pointer-events-none hover:bg-ink/10 transition-colors"
      >
        <span className={showCleaned ? 'text-ink-faint' : 'text-accent'}>Original</span>
        <span className="text-ink-faint">/</span>
        <span className={showCleaned ? 'text-accent' : 'text-ink-faint'}>Cleaned</span>
      </button>

      {hasCleaned && showCleaned && (
        <div className="hidden xl:flex items-center gap-1.5 shrink-0 pl-1" title="Blend the original page as an overlay above the cleaned page">
          <span className="text-micro text-ink-faint uppercase tracking-wide">Overlay</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={overlayOpacity}
            onChange={(e) => onOverlayOpacityChange(Number(e.target.value))}
            className="w-16 accent-accent"
            aria-label="Original page overlay opacity"
          />
        </div>
      )}

      <IconButton
        size="sm"
        aria-label={typeRegionArmed ? 'Disarm Type Region' : 'Arm Type Region — click or draw a selection to type into it'}
        title={typeRegionArmed ? 'Type Region armed — click or draw a selection to type into it' : 'Type Region'}
        onClick={onToggleTypeRegion}
        className={`shrink-0 max-lg:!w-11 max-lg:!h-11 ${typeRegionArmed ? '!bg-accent-soft !text-accent' : '!bg-transparent'}`}
      >
        <MessageSquareText size={15} />
      </IconButton>

      <div className="w-px h-6 bg-hairline mx-1 shrink-0 hidden lg:block" />

      <div className="hidden lg:flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
        {workflowStages.map((stage, i) => (
          <div key={stage.id} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-ink-faint/30 text-micro px-0.5">›</span>}
            <span
              className={`px-2 py-0.5 rounded-full text-micro font-medium whitespace-nowrap transition-colors ${
                !stage.tracked
                  ? 'text-ink-faint/40'
                  : stage.active
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-faint'
              }`}
            >
              {stage.label}
            </span>
          </div>
        ))}
      </div>
      <div className="flex-1 lg:hidden" />

      {/* Go Live is initiated from Teams' own Live section now (it already knows which team), not
          from here — this only ever shows a status: "Starting…" while a Teams-initiated session
          is spinning up, then a live/viewer-count pill the host can click to end. Never a plain
          idle "Go Live" button. */}
      {(isLive || goingLive) && (
        <button
          type="button"
          onClick={onToggleLive}
          disabled={!isLive}
          className={`shrink-0 flex items-center gap-1.5 h-8 px-2.5 rounded-control border text-ui font-medium transition-colors disabled:opacity-50 ${
            isLive ? 'bg-danger/15 border-danger/40 text-danger hover:bg-danger/25' : 'bg-ink/5 border-hairline text-ink'
          }`}
          title={isLive ? 'End the live session' : 'Starting the live session…'}
        >
          <Radio size={13} className={isLive ? 'animate-pulse' : ''} />
          <span className="hidden sm:inline">{isLive ? 'Live' : 'Starting…'}</span>
          {isLive && liveViewerCount > 0 && (
            <span className="flex items-center gap-0.5 text-micro"><Users size={11} />{liveViewerCount}</span>
          )}
        </button>
      )}

      {onOpenTextEditor && (
        <IconButton size="sm" aria-label="Open Text Editor" title="Text Editor" onClick={onOpenTextEditor} className="!bg-transparent shrink-0 max-lg:!w-11 max-lg:!h-11">
          <FileText size={15} />
        </IconButton>
      )}

      <IconButton size="sm" aria-label="Fit to screen" onClick={onFit} className="!bg-transparent shrink-0 max-lg:!w-11 max-lg:!h-11">
        <Maximize2 size={15} />
      </IconButton>
      <IconButton
        size="sm"
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={isFullscreen ? 'Exit fullscreen (Ctrl/Cmd+Shift+F)' : 'Fullscreen (Ctrl/Cmd+Shift+F)'}
        onClick={onToggleFullscreen}
        className={`!bg-transparent shrink-0 max-lg:!w-11 max-lg:!h-11 ${isFullscreen ? '!text-accent' : ''}`}
      >
        {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </IconButton>
      <IconButton size="sm" aria-label="Toggle tools panel" title="Tools" onClick={onToggleRightSidebar} className="!bg-transparent shrink-0 max-lg:!w-11 max-lg:!h-11">
        <PanelRight size={15} />
      </IconButton>
    </div>
  );
}
