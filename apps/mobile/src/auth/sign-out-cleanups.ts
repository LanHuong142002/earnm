/** The cleanups to run when the person signs out: every provider registers its own. */
export function createSignOutCleanups() {
  const cleanups = new Set<() => Promise<void>>();
  return {
    /** Adds a cleanup; the returned function removes it. */
    register(cleanup: () => Promise<void>): () => void {
      // Wrapped so registering the same function twice still gives two independent entries.
      const entry = () => cleanup();
      cleanups.add(entry);
      return () => {
        cleanups.delete(entry);
      };
    },
    /** Runs every cleanup, one failing never stopping the rest. */
    async runAll(): Promise<void> {
      for (const cleanup of [...cleanups]) {
        try {
          await cleanup();
        } catch {
          // Best effort: the sign-out itself must still happen.
        }
      }
    },
  };
}
