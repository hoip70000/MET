import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioCollabHandle } from '../../lib/studioCollab';

/** Same public-STUN-only tradeoff as useStudioVoiceChat.ts — no TURN server anywhere in this
 *  app's infra, so a peer behind a strict/symmetric NAT may fail to connect. */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Live screen-share video for a collab session — replaces the periodic downscaled-JPEG snapshot
 * (`broadcastFrame`/`onFrame`) with a real, continuous video feed of the host's Studio browser
 * tab. Deliberately a **star** topology (host connects outbound to every viewer individually),
 * not the mesh useStudioVoiceChat.ts uses for audio: screen share only ever flows one direction
 * (host → viewers), so a viewer never needs a peer connection to another viewer for this, unlike
 * voice where everyone talks to everyone. Signaled over the same studio-session Realtime channel,
 * on its own `screenshare-*` broadcast events (kept separate from `voice-*` so the two negotiation
 * flows can't collide on the same connection objects).
 *
 * `getDisplayMedia({ preferCurrentTab: true, ... })` biases Chrome's picker toward "This Tab" —
 * it can't force that choice (a real OS-level permission picker, by design, isn't scriptable),
 * but tab-capture mode (as opposed to "Entire Screen"/"Window") is exactly what keeps a viewer
 * locked onto the Studio tab's own rendered content even if the host alt-tabs to something else:
 * the browser keeps compositing the captured tab in the background regardless of which tab has
 * focus. Choosing "Entire Screen" instead is a host choice this code can't prevent — the toggle
 * button's label/title call out "This Tab" explicitly to steer toward the safe choice.
 */
export function useStudioScreenShare(params: {
  collabHandleRef: React.RefObject<StudioCollabHandle | null>;
  selfUserId: string | null;
  isHost: boolean;
  /** Only meaningful for the host — the viewers to connect out to. */
  peerUserIds: string[];
}) {
  const { collabHandleRef, selfUserId, isHost, peerUserIds } = params;
  const [sharing, setSharing] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  // Host: outbound connections, one per viewer. Viewer: the single inbound connection from the host.
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const teardownPeer = useCallback((peerId: string) => {
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
  }, []);

  const flushPendingIce = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(peerId);
    if (!queued) return;
    pendingIceRef.current.delete(peerId);
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate); } catch { /* stale/duplicate — harmless */ }
    }
  }, []);

  // Host → one viewer: create the outbound connection, attach the local capture track, offer.
  const connectToViewer = useCallback(async (viewerId: string) => {
    if (!localStreamRef.current || peersRef.current.has(viewerId)) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(viewerId, pc);
    for (const track of localStreamRef.current.getTracks()) pc.addTrack(track, localStreamRef.current);
    pc.onicecandidate = (e) => { if (e.candidate) collabHandleRef.current?.sendScreenshareIce(viewerId, e.candidate.toJSON()); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') teardownPeer(viewerId);
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    collabHandleRef.current?.sendScreenshareOffer(viewerId, offer);
  }, [collabHandleRef, teardownPeer]);

  const toggleSharing = useCallback(async () => {
    if (!isHost) return;
    if (sharing) {
      for (const peerId of Array.from(peersRef.current.keys())) teardownPeer(peerId);
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      setSharing(false);
      collabHandleRef.current?.announceScreenshareEnded();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' } as MediaTrackConstraints,
        audio: false,
        // Chrome-only hint; ignored elsewhere. See the module doc comment for why tab-capture
        // mode is what actually keeps the feed scoped to this tab regardless of host focus.
        // @ts-expect-error — not yet in lib.dom.d.ts's MediaStreamConstraints
        preferCurrentTab: true,
      });
      localStreamRef.current = stream;
      // The host ending the share via the browser's own native "Stop sharing" bar doesn't go
      // through toggleSharing() at all — this is the only way to catch that and clean up.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => toggleSharing());
      setSharing(true);
      for (const viewerId of peerUserIds) connectToViewer(viewerId);
    } catch (err) {
      console.error('Screen share unavailable/denied', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, sharing, peerUserIds, connectToViewer, teardownPeer, collabHandleRef]);

  // New viewers joining mid-share get connected to; viewers who leave get torn down. Mirrors
  // useStudioVoiceChat's identical peer-list-reconciliation effect.
  useEffect(() => {
    if (!isHost || !sharing) return;
    const current = new Set(peerUserIds);
    for (const viewerId of peerUserIds) connectToViewer(viewerId);
    for (const peerId of Array.from(peersRef.current.keys())) {
      if (!current.has(peerId)) teardownPeer(peerId);
    }
  }, [isHost, sharing, peerUserIds, connectToViewer, teardownPeer]);

  // Viewer: an offer only ever legitimately comes from the host (studioCollab.ts's own
  // self.isHost gate on the host side means a non-host never sends one), so no extra sender check
  // is needed here beyond "I'm not the host."
  const handleOffer = useCallback(async (fromUserId: string, sdp: RTCSessionDescriptionInit) => {
    if (isHost || !selfUserId) return;
    teardownPeer(fromUserId); // a fresh offer (host restarted sharing) replaces any stale connection
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(fromUserId, pc);
    pc.onicecandidate = (e) => { if (e.candidate) collabHandleRef.current?.sendScreenshareIce(fromUserId, e.candidate.toJSON()); };
    pc.ontrack = (e) => setRemoteStream(e.streams[0] ?? null);
    await pc.setRemoteDescription(sdp);
    await flushPendingIce(fromUserId, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    collabHandleRef.current?.sendScreenshareAnswer(fromUserId, answer);
  }, [isHost, selfUserId, teardownPeer, flushPendingIce, collabHandleRef]);

  const handleAnswer = useCallback(async (fromUserId: string, sdp: RTCSessionDescriptionInit) => {
    const pc = peersRef.current.get(fromUserId);
    if (!pc) return;
    await pc.setRemoteDescription(sdp);
    await flushPendingIce(fromUserId, pc);
  }, [flushPendingIce]);

  const handleIce = useCallback(async (fromUserId: string, candidate: RTCIceCandidateInit) => {
    const pc = peersRef.current.get(fromUserId);
    if (!pc || !pc.remoteDescription) {
      const queue = pendingIceRef.current.get(fromUserId) ?? [];
      queue.push(candidate);
      pendingIceRef.current.set(fromUserId, queue);
      return;
    }
    try { await pc.addIceCandidate(candidate); } catch { /* stale/duplicate — harmless */ }
  }, []);

  const handleEnded = useCallback(() => {
    for (const peerId of Array.from(peersRef.current.keys())) teardownPeer(peerId);
    setRemoteStream(null);
  }, [teardownPeer]);

  useEffect(() => () => {
    for (const peerId of Array.from(peersRef.current.keys())) teardownPeer(peerId);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { sharing, toggleSharing, remoteStream, handleOffer, handleAnswer, handleIce, handleEnded };
}
