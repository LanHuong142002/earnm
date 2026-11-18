const listeners = new Set<() => void>();

/** Runs `listener` whenever the phone's notification schedule should be planned again (e.g. permission was just granted). */
export function onScheduleSignal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function signalSchedule(): void {
  for (const listener of [...listeners]) listener();
}
