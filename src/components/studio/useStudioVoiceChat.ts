import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioCollabHandle } from '../../lib/studioCollab';

/** Public STUN only — no TURN server exists anywhere in this app's infra, so a peer behind a
 *  strict/symmetric NAT (common on some corporate or mobile-carrier networks) may fail to connect
 *  directly. A known, accepted limit for a v1 mesh, not solved here. */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** How often to sample each stream's volume for the speaking indicator. Doesn't need to be
 *  animation-frame-rate — a pulsing avatar reads fine updated a few times a second. */
const SPEAKING_POLL_MS = 150;
/** 0-255 scale (time-domain deviation from the silent midpoint, 128) — picked empirically high
 *  enough that room noise/mic hiss doesn't read as "speaking", low enough that normal speech does. */
const SPEAKING_THRESHOLD = 14;

interface PeerVoice {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  analyser: AnalyserNode | null;
}

/**
 * WebRTC mesh voice chat for a live collab session, signaled entirely over the same Supabase
 * Realtime channel joinStudioSessionChannel already opened for cursors/chat/frames (see the
 * voice-offer/voice-answer/voice-ice broadcast events in studioCollab.ts) — no separate signaling
 * server. Every participant connects directly to every other participant (a full mesh), which is
 * the right tradeoff at the small "a handful of teammates watching together" scale this feature
 * targets; it would not scale to a large audience the way the canvas broadcast (one-way, host to
 * many) does.
 *
 * Mic access is strictly opt-in via `toggleJoined()` — it never requests getUserMedia on its own,
 * both because unsolicited mic prompts are hostile and because a silent viewer shouldn't need to
 * grant mic permission just to watch.
 */
export function useStudioVoiceChat(params: {
  collabHandleRef: React.RefObject<StudioCollabHandle | null>;
  selfUserId: string | null;
  peerUserIds: string[];
}) {
  const { collabHandleRef, selfUserId, peerUserIds } = params;
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speakingUserIds, setSpeakingUserIds] = useState<Set<string>>(new Set());

  const localStreamRef = useRef<MediaStream | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const peersRef = useRef<Map<string, PeerVoice>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  }, []);

  const teardownPeer = useCallback((peerId: string) => {
    const p = peersRef.current.get(peerId);
    if (!p) return;
    p.pc.close();
    p.audioEl.srcObject = null;
    p.audioEl.remove();
    peersRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    setSpeakingUserIds(prev => { if (!prev.has(peerId)) return prev; const next = new Set(prev); next.delete(peerId); return next; });
  }, []);

  const createPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audioEl = new Audio();
    audioEl.autoplay = true;
    const entry: PeerVoice = { pc, audioEl, analyser: null };
    peersRef.current.set(peerId, entry);

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) pc.addTrack(track, localStreamRef.current);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) collabHandleRef.current?.sendVoiceIce(peerId, e.candidate.toJSON());
    };
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      audioEl.srcObject = stream;
      const ctx = ensureAudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      entry.analyser = analyser;
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') teardownPeer(peerId);
    };
    return pc;
  }, [collabHandleRef, ensureAudioCtx, teardownPeer]);

  const flushPendingIce = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(peerId);
    if (!queued) return;
    pendingIceRef.current.delete(peerId);
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate); } catch { /* stale/duplicate candidate — harmless */ }
    }
  }, []);

  // Deterministic initiator per pair (lower userId offers) — both sides compute the same answer
  // independently from the same presence roster, so there's no "who joined first" race to track.
  const connectToPeer = useCallback(async (peerId: string) => {
    if (!selfUserId || peersRef.current.has(peerId)) return;
    const pc = createPeerConnection(peerId);
    if (selfUserId < peerId) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      collabHandleRef.current?.sendVoiceOffer(peerId, offer);
    }
  }, [selfUserId, createPeerConnection, collabHandleRef]);

  const handleOffer = useCallback(async (fromUserId: string, sdp: RTCSessionDescriptionInit) => {
    if (!joined) return; // not in the voice call — ignore, don't answer calls no one asked to join
    let entry = peersRef.current.get(fromUserId);
    const pc = entry?.pc ?? createPeerConnection(fromUserId);
    await pc.setRemoteDescription(sdp);
    entry = peersRef.current.get(fromUserId);
    if (entry) await flushPendingIce(fromUserId, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    collabHandleRef.current?.sendVoiceAnswer(fromUserId, answer);
  }, [joined, createPeerConnection, flushPendingIce, collabHandleRef]);

  const handleAnswer = useCallback(async (fromUserId: string, sdp: RTCSessionDescriptionInit) => {
    const entry = peersRef.current.get(fromUserId);
    if (!entry) return;
    await entry.pc.setRemoteDescription(sdp);
    await flushPendingIce(fromUserId, entry.pc);
  }, [flushPendingIce]);

  const handleIce = useCallback(async (fromUserId: string, candidate: RTCIceCandidateInit) => {
    const entry = peersRef.current.get(fromUserId);
    if (!entry || !entry.pc.remoteDescription) {
      const queue = pendingIceRef.current.get(fromUserId) ?? [];
      queue.push(candidate);
      pendingIceRef.current.set(fromUserId, queue);
      return;
    }
    try { await entry.pc.addIceCandidate(candidate); } catch { /* stale/duplicate — harmless */ }
  }, []);

  const toggleJoined = useCallback(async () => {
    if (joined) {
      for (const peerId of Array.from(peersRef.current.keys())) teardownPeer(peerId);
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      localAnalyserRef.current = null;
      setJoined(false);
      setMuted(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const ctx = ensureAudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      localAnalyserRef.current = analyser;
      setJoined(true);
      for (const peerId of peerUserIds) connectToPeer(peerId);
    } catch (err) {
      console.error('Microphone unavailable', err);
    }
  }, [joined, peerUserIds, connectToPeer, ensureAudioCtx, teardownPeer]);

  const toggleMuted = useCallback(() => {
    if (!localStreamRef.current) return;
    const next = !muted;
    for (const track of localStreamRef.current.getAudioTracks()) track.enabled = !next;
    setMuted(next);
  }, [muted]);

  // New peers appearing while already joined (someone else joins the session) get connected to —
  // only the ones this side is responsible for initiating (see connectToPeer's deterministic
  // tie-break); peers who vanish (left the session) get torn down.
  useEffect(() => {
    if (!joined) return;
    const current = new Set(peerUserIds);
    for (const peerId of peerUserIds) connectToPeer(peerId);
    for (const peerId of Array.from(peersRef.current.keys())) {
      if (!current.has(peerId)) teardownPeer(peerId);
    }
  }, [joined, peerUserIds, connectToPeer, teardownPeer]);

  // Polls every connected stream's volume (local + each remote) rather than reacting per audio
  // frame — a pulsing avatar doesn't need 60fps precision, and this keeps CPU cost negligible
  // even with several peers connected.
  useEffect(() => {
    if (!joined) { setSpeakingUserIds(new Set()); return; }
    const buf = new Uint8Array(512);
    const interval = setInterval(() => {
      const next = new Set<string>();
      const localAnalyser = localAnalyserRef.current;
      if (localAnalyser && !muted && selfUserId) {
        localAnalyser.getByteTimeDomainData(buf);
        if (amplitudeOf(buf) > SPEAKING_THRESHOLD) next.add(selfUserId);
      }
      for (const [peerId, entry] of peersRef.current) {
        if (!entry.analyser) continue;
        entry.analyser.getByteTimeDomainData(buf);
        if (amplitudeOf(buf) > SPEAKING_THRESHOLD) next.add(peerId);
      }
      setSpeakingUserIds(prev => (setsEqual(prev, next) ? prev : next));
    }, SPEAKING_POLL_MS);
    return () => clearInterval(interval);
  }, [joined, muted, selfUserId]);

  // Full teardown on unmount (leaving Studio entirely) — same cleanup toggleJoined(false) does.
  useEffect(() => () => {
    for (const peerId of Array.from(peersRef.current.keys())) teardownPeer(peerId);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { joined, muted, toggleJoined, toggleMuted, speakingUserIds, handleOffer, handleAnswer, handleIce };
}

function amplitudeOf(buf: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += Math.abs(buf[i] - 128);
  return sum / buf.length;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
