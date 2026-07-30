import { useRef, useState } from 'react';

/** Records a short voice message via MediaRecorder and hands back a ready-to-upload File —
 *  reuses whatever attachment pipeline the caller already has (the same one a Paperclip file
 *  attach uses) rather than inventing a separate voice-message upload path. */
export function useVoiceRecorder(onRecorded: (file: File) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        onRecorded(new File([blob], `voice-message-${Date.now()}.webm`, { type: 'audio/webm' }));
      };
      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone unavailable', err);
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    setIsRecording(false);
  };

  const toggle = () => { isRecording ? stop() : start(); };

  return { isRecording, toggle };
}
