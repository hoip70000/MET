import type { StudioCollabPeer } from '../../lib/studioCollab';

interface RemoteCursor {
  userId: string;
  name: string;
  /** Page-space coordinates (unscaled image pixels) — resolution/zoom-independent on receipt. */
  x: number;
  y: number;
}

interface CollabCursorsProps {
  cursors: RemoteCursor[];
  peers: StudioCollabPeer[];
  /** Page-space -> container-space, matching however the canvas itself converts (pos, scale, offset). */
  toContainer: (x: number, y: number) => { x: number; y: number };
}

const COLORS = ['#f97316', '#22c55e', '#3b82f6', '#e879f9', '#eab308', '#14b8a6', '#ef4444'];

function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

/**
 * Remote participants' live cursors, overlaid above the Konva stage — modeled directly on
 * BrushCursor.tsx's SVG-over-stage pattern so it can never reach exports or the layer stack.
 */
export function CollabCursors({ cursors, peers, toContainer }: CollabCursorsProps) {
  if (cursors.length === 0) return null;
  const nameById = new Map(peers.map(p => [p.userId, p.name]));

  return (
    <svg className="pointer-events-none absolute inset-0 w-full h-full z-20" aria-hidden>
      {cursors.map((c) => {
        const pos = toContainer(c.x, c.y);
        const color = colorFor(c.userId);
        const name = nameById.get(c.userId) ?? c.name;
        return (
          <g key={c.userId} transform={`translate(${pos.x} ${pos.y})`}>
            {/* Classic macOS/system arrow-pointer silhouette, hotspot at the tip (0,0) — same
                shape convention Figma/multiplayer cursors use, just colour-coded per participant
                instead of the OS's flat black, with a white outline so it reads on any art. */}
            <path
              d="M0 0 L0 15.5 L3.8 12.1 L6.3 18.5 L8.9 17.4 L6.4 11.2 L11.9 11.2 Z"
              fill={color}
              stroke="#fff"
              strokeWidth={1.2}
              strokeLinejoin="round"
            />
            <g transform="translate(13 17)">
              <rect x={0} y={0} width={Math.max(24, name.length * 6.5 + 10)} height={16} rx={4} fill={color} />
              <text x={5} y={11} fontSize={10} fill="#fff" fontFamily="sans-serif">{name}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
