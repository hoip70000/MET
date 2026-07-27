import { useEffect, useMemo, useRef, useState } from 'react';
import splashVideoWebm from '../assets/splash-intro.webm';
import splashVideoMp4 from '../assets/splash-intro.mp4';

type Phase = 'loading' | 'playing' | 'leaving';

interface Particle {
  id: number;
  left: string;
  top: string;
  size: number;
  x: string;
  y: string;
  duration: string;
  delay: string;
}

function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, id) => {
    const angle = Math.random() * Math.PI * 2;
    const distance = 120 + Math.random() * 260;
    return {
      id,
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      size: 2 + Math.random() * 4,
      x: `${Math.cos(angle) * distance}px`,
      y: `${Math.sin(angle) * distance}px`,
      duration: `${700 + Math.random() * 500}ms`,
      delay: `${Math.random() * 150}ms`,
    };
  });
}

export function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const videoRef = useRef<HTMLVideoElement>(null);
  const particles = useMemo(() => makeParticles(48), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const play = () => {
      setPhase(p => (p === 'loading' ? 'playing' : p));
      video.play().catch(() => {});
    };

    if (video.readyState >= 3) {
      play();
    } else {
      video.addEventListener('canplaythrough', play, { once: true });
    }

    // Safety net in case the video never fires canplaythrough (e.g. slow/odd network).
    const loadTimeout = setTimeout(play, 4000);

    return () => {
      video.removeEventListener('canplaythrough', play);
      clearTimeout(loadTimeout);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'playing') return;
    // Safety net in case `ended` never fires.
    const playTimeout = setTimeout(finish, 8000);
    return () => clearTimeout(playTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function finish() {
    setPhase(p => (p === 'leaving' ? p : 'leaving'));
    // Matches the pull-up animation's own duration (see .animate-splash-pull-up) — the
    // screen has physically left the viewport by the time onFinish unmounts it.
    setTimeout(onFinish, 260);
  }

  return (
    <div
      className={`fixed inset-0 z-[999] bg-black overflow-hidden ${
        phase === 'leaving' ? 'pointer-events-none animate-splash-pull-up' : ''
      }`}
    >
      <video
        ref={videoRef}
        preload="auto"
        muted
        playsInline
        onEnded={finish}
        className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-500 ${
          phase === 'loading' ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <source src={splashVideoWebm} type="video/webm" />
        <source src={splashVideoMp4} type="video/mp4" />
      </video>

      {/* A brief burst of embers rides along with the pull-up for texture, rather than
          carrying the whole exit transition on its own. */}
      {phase === 'leaving' && (
        <div className="absolute inset-0">
          {particles.map(p => (
            <span
              key={p.id}
              className="absolute rounded-full bg-white animate-splash-particle"
              style={{
                left: p.left,
                top: p.top,
                width: p.size,
                height: p.size,
                boxShadow: '0 0 6px 1px color-mix(in srgb, var(--color-accent) 70%, white)',
                ['--particle-x' as string]: p.x,
                ['--particle-y' as string]: p.y,
                ['--particle-duration' as string]: p.duration,
                animationDelay: p.delay,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
