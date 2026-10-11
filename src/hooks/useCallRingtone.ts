import { useCallback, useEffect, useRef, useState } from 'react';

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** Ringtone for either call type, without audio downloads or capture permission. */
export function useCallRingtone(invitation: string | null, enabled: boolean) {
  const audio = useRef<AudioContext | null>(null), notes = useRef(new Set<OscillatorNode>());
  const [blocked, setBlocked] = useState(false), [quiet, setQuiet] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(0);
  const stop = useCallback(() => {
    for (const note of notes.current) { try { note.stop(); } catch { /* Already finished. */ } }
    notes.current.clear();
  }, []);
  const context = useCallback(() => {
    const Constructor = window.AudioContext || (window as AudioWindow).webkitAudioContext;
    if (!Constructor) return null;
    if (!audio.current || audio.current.state === 'closed') audio.current = new Constructor();
    return audio.current;
  }, []);
  const unlock = useCallback(() => {
    try {
      const node = context();
      if (!node) return;
      void node.resume().then(() => { setBlocked(node.state !== 'running'); setUnlocked(n => n + 1); }).catch(() => setBlocked(true));
    } catch { setBlocked(true); }
  }, [context]);
  useEffect(() => {
    if (!enabled) return;
    const gesture = (event: Event) => {
      // The sound button must keep the action selected on pointerdown through click.
      if (event.target instanceof Element && event.target.closest('[data-call-sound-control]')) return;
      if (audio.current?.state !== 'running') unlock();
    };
    window.addEventListener('pointerdown', gesture, true); window.addEventListener('keydown', gesture, true);
    return () => { window.removeEventListener('pointerdown', gesture, true); window.removeEventListener('keydown', gesture, true); };
  }, [enabled, unlock]);
  useEffect(() => {
    if (!enabled || !invitation || quiet === invitation) return;
    let node: AudioContext | null;
    try { node = context(); } catch { setBlocked(true); return; }
    if (!node) return;
    const ring = () => {
      if (node.state !== 'running') { setBlocked(true); return; }
      setBlocked(false);
      for (const offset of [0, 0.42]) {
        const note = node.createOscillator(), gain = node.createGain(), start = node.currentTime + offset;
        note.type = 'sine'; note.frequency.value = 660;
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.12, start + 0.025); gain.gain.linearRampToValueAtTime(0, start + 0.3);
        note.connect(gain); gain.connect(node.destination); notes.current.add(note);
        note.onended = () => { notes.current.delete(note); note.disconnect(); gain.disconnect(); };
        note.start(start); note.stop(start + 0.32);
      }
    };
    ring(); const timer = window.setInterval(ring, 2800);
    return () => { window.clearInterval(timer); stop(); };
  }, [context, enabled, invitation, quiet, stop, unlocked]);
  useEffect(() => () => { stop(); void audio.current?.close().catch(() => {}); audio.current = null; }, [stop]);
  return { blocked, muted: !!invitation && quiet === invitation, unlock,
    toggle: () => { stop(); setQuiet(quiet === invitation ? null : invitation); unlock(); } };
}
