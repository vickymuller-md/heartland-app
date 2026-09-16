'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sequential playback queue for the assistant's audio (static clips and
 * synthesized data URLs) through one hidden <audio> element. Autoplay
 * rejection pauses the queue behind `needsTap`; `resumeAfterTap` continues it
 * from a user gesture. A failed source advances instead of stalling.
 */
export function useAssistantAudioQueue() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mountedAudioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const mountedRef = useRef(false);
  const attemptRef = useRef(0);
  const pendingRef = useRef<string | null>(null);
  const removeListenersRef = useRef<(() => void) | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [needsTap, setNeedsTap] = useState<string | null>(null);

  function playSource(src: string) {
    const audio = audioRef.current;
    if (!audio || !mountedRef.current) return;
    removeListenersRef.current?.();
    const attempt = ++attemptRef.current;
    let settled = false;
    const current = () => mountedRef.current && attemptRef.current === attempt && !settled;
    const advance = () => {
      if (!current()) return;
      settled = true;
      removeListenersRef.current?.();
      removeListenersRef.current = null;
      pendingRef.current = null;
      setNeedsTap(null);
      playNextRef.current();
    };
    const failed = (error: unknown) => {
      if (!current()) return;
      if ((error as { name?: string })?.name === 'NotAllowedError') {
        pendingRef.current = src;
        setNeedsTap(src);
      } else {
        // A promise rejection and a media error may report the same failure.
        // Advancing settles this attempt before starting the next source.
        advance();
      }
    };
    // A queued DOM event has no source identity. The element's current state
    // resets when src changes, unlike an event from the previous resource.
    const ended = () => { if (audio.ended) advance(); };
    const errored = () => { if (audio.error) advance(); };
    audio.addEventListener('ended', ended);
    audio.addEventListener('error', errored);
    removeListenersRef.current = () => {
      audio.removeEventListener('ended', ended);
      audio.removeEventListener('error', errored);
    };
    playingRef.current = true;
    pendingRef.current = null;
    setSpeaking(true);
    setNeedsTap(null);
    try {
      audio.src = src;
      audio.play()?.catch(failed);
    } catch (error) {
      failed(error);
    }
  }

  function playNext() {
    if (!mountedRef.current) return;
    const next = queueRef.current.shift();
    if (next) playSource(next);
    else {
      playingRef.current = false;
      setSpeaking(false);
    }
  }
  const playNextRef = useRef(playNext);
  useEffect(() => {
    playNextRef.current = playNext;
  });

  const stop = useCallback(() => {
    attemptRef.current += 1;
    removeListenersRef.current?.();
    removeListenersRef.current = null;
    queueRef.current = [];
    pendingRef.current = null;
    playingRef.current = false;
    // React may detach the DOM ref before passive unmount cleanup runs.
    const audio = audioRef.current ?? mountedAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setSpeaking(false);
    setNeedsTap(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    mountedAudioRef.current = audioRef.current;
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop]);

  function enqueue(src: string) {
    if (!mountedRef.current) return;
    queueRef.current.push(src);
    if (!playingRef.current) playNext();
  }

  function resumeAfterTap() {
    const pending = pendingRef.current;
    if (pending) playSource(pending);
  }

  return { audioRef, speaking, needsTap, enqueue, resumeAfterTap, stop };
}
