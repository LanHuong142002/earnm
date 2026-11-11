/**
 * Generic offline write queue. Knows nothing about any feature: each entity
 * registers a Sender per change kind, so a kind with no way to be sent is a type error.
 *
 * - enqueue(input): adds a change (merging with an unsent change for the same item),
 *   persists it, and resolves with the stored change. Throws for an unregistered entity.
 *   It does not send; call flush().
 * - flush(expectedOwnerId?): sends waiting changes in order, one at a time. Concurrent calls
 *   share the single runner; a call made mid-run makes it run once more. When
 *   expectedOwnerId is passed (a string or null), nothing is sent unless it is a string equal
 *   to the stored owner, so another person's changes are never sent with this token.
 * - A create that was already sent once (attempts > 0) is never merged into or dropped by a
 *   later update or delete: the server may have it even though the reply was lost, so those
 *   are queued after it as their own requests.
 * - A change whose entity has no registered senders is kept and stops the queue (it is not
 *   rejected): the entity may be registered later.
 * - waiting() / count(): the changes still waiting (copies).
 * - setOwner(userId): resolves true if a different stored owner's changes were dropped.
 * - clear({ owner? }): drops all changes, and the owner too when asked.
 *
 * Persisted as { ownerId, changes } under one key, loaded once on first use.
 */
import { ApiError } from "../lib/api";
import type { KeyValueStore } from "./storage";

export type ChangeKind = "create" | "update" | "delete";

export type Change = {
  changeId: string;
  entity: string;
  entityId: string;
  kind: ChangeKind;
  /** Field values (create: all fields; update: only the changed ones). */
  data: Record<string, unknown>;
  /** ISO editedAt per field in `data`. */
  fieldTimes: Record<string, string>;
  createdAt: string;
  /** How many times a send was started. Set (and saved) before each send; > 0 means the server may already have it. */
  attempts?: number;
};

export type NewChange = {
  entity: string;
  entityId: string;
  kind: ChangeKind;
  data: Record<string, unknown>;
  /** Defaults to "now" for any field in `data` without a time. */
  fieldTimes?: Record<string, string>;
  changeId?: string;
};

export type Sender = (change: Change, token: string) => Promise<unknown>;

export type QueueOptions = {
  store: KeyValueStore;
  storageKey?: string;
  getToken: () => Promise<string | null>;
  onApplied: (change: Change, response: unknown) => void;
  onRejected: (change: Change, error: ApiError) => void;
  onSignedOut: () => void;
};

type Persisted = { ownerId: string | null; changes: Change[] };

const DEFAULT_KEY = "sync.queue.v1";

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isNewer(candidate: string | undefined, current: string | undefined): boolean {
  if (candidate === undefined) return false;
  if (current === undefined) return true;
  return Date.parse(candidate) >= Date.parse(current); // ties: the later enqueue wins
}

function mergeFields(base: Change, incoming: Change): void {
  for (const field of Object.keys(incoming.data)) {
    if (base.fieldTimes[field] === undefined || isNewer(incoming.fieldTimes[field], base.fieldTimes[field])) {
      base.data[field] = incoming.data[field];
      base.fieldTimes[field] = incoming.fieldTimes[field];
    }
  }
}

/** Every 4xx except 401 (sign in again), 408 (timeout) and 429 (rate limit) will never succeed on a resend. */
function isPermanentRejection(error: ApiError): boolean {
  if (error.code === "validation_failed") return true;
  return error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChange(value: unknown): value is Change {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.changeId === "string" &&
    value.changeId !== "" &&
    typeof value.entity === "string" &&
    value.entity !== "" &&
    typeof value.entityId === "string" &&
    value.entityId !== "" &&
    (value.kind === "create" || value.kind === "update" || value.kind === "delete") &&
    isPlainObject(value.data) &&
    isPlainObject(value.fieldTimes) &&
    typeof value.createdAt === "string"
  );
}

export function createQueue(options: QueueOptions) {
  const { store, getToken, onApplied, onRejected, onSignedOut } = options;
  const key = options.storageKey ?? DEFAULT_KEY;
  const senders = new Map<string, Record<ChangeKind, Sender>>();

  let state: Persisted | null = null;
  let loading: Promise<Persisted> | null = null;
  let sendingId: string | null = null;
  let running: Promise<void> | null = null;
  let rerun = false;
  let writes: Promise<void> = Promise.resolve();

  function load(): Promise<Persisted> {
    if (state) return Promise.resolve(state);
    loading ??= store.getJSON<Persisted>(key).then(
      (saved) => {
        state = {
          ownerId: typeof saved?.ownerId === "string" ? saved.ownerId : null,
          changes: Array.isArray(saved?.changes) ? saved.changes.filter(isChange) : [],
        };
        return state;
      },
      (error: unknown) => {
        loading = null; // a failed read is retried on the next call
        throw error;
      },
    );
    return loading;
  }

  function persist(): Promise<void> {
    const snapshot: Persisted = JSON.parse(JSON.stringify(state)) as Persisted;
    // Start from a settled chain so an earlier failure never blocks this write; this write's own
    // failure still reaches its caller.
    const write = writes.catch(() => {}).then(() => store.setJSON(key, snapshot));
    writes = write;
    return write;
  }

  function registerEntity(entity: string, entitySenders: Record<ChangeKind, Sender>) {
    senders.set(entity, entitySenders);
  }

  async function enqueue(input: NewChange): Promise<Change> {
    if (!senders.has(input.entity)) throw new Error(`No senders registered for "${input.entity}"`);
    const s = await load();
    const now = new Date().toISOString();
    const fieldTimes: Record<string, string> = { ...input.fieldTimes };
    for (const field of Object.keys(input.data)) fieldTimes[field] ??= now;
    const change: Change = {
      changeId: input.changeId ?? newId(),
      entity: input.entity,
      entityId: input.entityId,
      kind: input.kind,
      data: { ...input.data },
      fieldTimes,
      createdAt: now,
    };

    let index = -1;
    for (let i = s.changes.length - 1; i >= 0; i--) {
      const c = s.changes[i];
      if (c.entity === change.entity && c.entityId === change.entityId) {
        index = i;
        break;
      }
    }
    const existing = index >= 0 ? s.changes[index] : null;

    // A failed save must leave the queue as it was, or the change would be sent later and a retry
    // would duplicate it.
    const changesBefore = s.changes.slice();
    const existingBefore = existing ? { data: { ...existing.data }, fieldTimes: { ...existing.fieldTimes } } : null;
    async function save(): Promise<void> {
      try {
        await persist();
      } catch (error) {
        s.changes = changesBefore;
        if (existing && existingBefore) {
          existing.data = existingBefore.data;
          existing.fieldTimes = existingBefore.fieldTimes;
        }
        throw error;
      }
    }

    if (!existing || existing.changeId === sendingId || existing.kind === "delete") {
      s.changes.push(change);
      await save();
      return change;
    }
    const attemptedCreate = existing.kind === "create" && (existing.attempts ?? 0) > 0;
    if (attemptedCreate && change.kind !== "create") {
      // The server may already have the create: the update goes after it as its own request,
      // and a delete is sent rather than dropped.
      s.changes.push(change);
      await save();
      return change;
    }
    if (change.kind === "update") {
      // update+update stays an update; create+update folds into the create.
      mergeFields(existing, change);
      await save();
      return existing;
    }
    if (change.kind === "delete") {
      if (existing.kind === "create") s.changes.splice(index, 1);
      else s.changes[index] = change; // update+delete: a single delete, same position
      await save();
      return change;
    }
    // A create for an item that already has an unsent change: keep both, in order.
    s.changes.push(change);
    await save();
    return change;
  }

  async function runPass(expectedOwnerId: string | null | undefined): Promise<boolean> {
    const s = await load();
    if (s.changes.length > 0 && expectedOwnerId !== undefined && (expectedOwnerId === null || s.ownerId !== expectedOwnerId)) {
      return false; // not provably this person's changes
    }
    const token = await getToken();
    if (!token) return false;
    while (s.changes.length > 0) {
      const change = s.changes[0];
      const entitySenders = senders.get(change.entity);
      if (!entitySenders) return false;
      sendingId = change.changeId;
      change.attempts = (change.attempts ?? 0) + 1;
      let response: unknown;
      try {
        await persist(); // the attempt is saved before the request leaves
        response = await entitySenders[change.kind](change, token);
      } catch (error) {
        sendingId = null;
        if (error instanceof ApiError) {
          if (error.code === "not_signed_in") {
            onSignedOut();
            return false;
          }
          if (change.kind === "delete" && error.status === 404) {
            // Already gone is what a delete wanted.
            s.changes = s.changes.filter((c) => c.changeId !== change.changeId);
            await persist();
            onApplied(change, undefined);
            continue;
          }
          if (isPermanentRejection(error)) {
            s.changes = s.changes.filter((c) => c.changeId !== change.changeId);
            await persist();
            onRejected(change, error);
            continue;
          }
        }
        return false; // network or unknown: keep this and the rest
      }
      sendingId = null;
      s.changes = s.changes.filter((c) => c.changeId !== change.changeId);
      await persist();
      onApplied(change, response);
    }
    return true;
  }

  function flush(expectedOwnerId?: string | null): Promise<void> {
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          rerun = false;
          const completed = await runPass(expectedOwnerId);
          if (!completed) rerun = false; // stopped on purpose; wait for the next trigger
        } while (rerun);
      } finally {
        running = null;
        rerun = false;
      }
    })();
    return running;
  }

  async function waiting(): Promise<Change[]> {
    const s = await load();
    return JSON.parse(JSON.stringify(s.changes)) as Change[];
  }

  async function count(): Promise<number> {
    return (await load()).changes.length;
  }

  async function ownerId(): Promise<string | null> {
    return (await load()).ownerId;
  }

  async function setOwner(userId: string): Promise<boolean> {
    const s = await load();
    const cleared = s.ownerId !== null && s.ownerId !== userId;
    if (cleared) s.changes = [];
    if (cleared || s.ownerId !== userId) {
      s.ownerId = userId;
      await persist();
    }
    return cleared;
  }

  async function clear(opts: { owner?: boolean } = {}): Promise<void> {
    const s = await load();
    s.changes = [];
    if (opts.owner) s.ownerId = null;
    await persist();
  }

  return { registerEntity, enqueue, flush, waiting, count, ownerId, setOwner, clear };
}

export type Queue = ReturnType<typeof createQueue>;
