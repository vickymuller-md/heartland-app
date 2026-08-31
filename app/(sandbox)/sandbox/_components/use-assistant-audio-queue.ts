'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Sequential playback queue for the assistant's audio (static clips and
 * synthesized data URLs) through one hidden <audio> element. Autoplay
 * rejection pauses the queue behind `needsTap`; `resumeAfterTap` continues it
 * from a user gesture. A failed source advances instead of stalling.
 */
export function useAssistantAudioQueue() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [needsTap, setNeedsTap] = useState<string | null>(null);

  function playNext() {
    const audio = audioRef.current;
    const next = queueRef.current.shift();
    if (!audio || !next) {
      playingRef.current = false;
      setSpeaking(false);
      return;
    }
    playingRef.current = true;
    setSpeaking(true);
    try {
      audio.src = next;
      const playing = audio.play();
      setNeedsTap(null);
      // Only an autoplay block waits for a tap. A missing/undecodable source
      // (NotSupportedError) already fires the element's 'error' event, which
      // advances the queue — the call continues text-only for that line.
      playing?.catch((error: unknown) => {
        if ((error as { name?: string })?.name === 'NotAllowedError') setNeedsTap(next);
      });
    } catch {
      setNeedsTap(next);
    }
  }
  const playNextRef = useRef(playNext);
  useEffect(() => {
    playNextRef.current = playNext;
  });

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const advance = () => playNextRef.current();
    audio.addEventListener('ended', advance);
    audio.addEventListener('error', advance);
    return () => {
      audio.removeEventListener('ended', advance);
      audio.removeEventListener('error', advance);
    };
  }, []);

  function enqueue(src: string) {
    queueRef.current.push(src);
    if (!playingRef.current) playNext();
  }

  function resumeAfterTap() {
    const audio = audioRef.current;
    const pending = needsTap;
    if (!audio || !pending) return;
    audio.src = pending;
    void audio.play().catch(() => undefined);
    setNeedsTap(null);
  }

  return { audioRef, speaking, needsTap, enqueue, resumeAfterTap };
}
