/**
 * The sync cycle for drafts, kept free of React so it can be tested. Drafts share the one write queue (the projects
 * provider flushes it), so this does not flush: it supplies the result `handlers` for `registerDraftEntities`, and
 * fetches a project's drafts again when asked.
 *
 * - handlers.onApplied: the cached draft becomes the server's reply (every draft, status and line change answers with
 *   the whole draft; a malformed reply marks the project for refresh).
 * - handlers.onRejected: sets the notice (with the missing list of a refused Done) and marks the project for refresh.
 * - refresh(projectId): list and save. Waiting changes are not saved in the cache.
 * - refreshPending(): after a flush, refresh every project marked above.
 */
import { ApiError } from "../lib/api";
import type { Change, ChangeKind } from "../sync/queue";
import { reasonFor, type RejectedReason } from "../tasks/outcomes";
import { DRAFT_ENTITY, DRAFT_LINE_ENTITY, DRAFT_STATUS_ENTITY } from "./entities";
import { isDraft, withDraft, withoutDraft, withoutDraftLine } from "./store";
import type { Draft, ServerMissing } from "./types";

export type DraftRefreshResult = "ok" | "offline" | "error" | "gone" | "skipped";

export type DraftRejectedReason = RejectedReason | "nameTaken" | "converted" | "duplicateLine" | "incomplete";

/** A refused draft change, for the notice at the top of the screen. */
export type DraftRejectedNotice = {
  entity: "draft" | "draftStatus" | "draftLine";
  kind: ChangeKind;
  /** The draft's name, when the phone knows it. */
  name: string | null;
  reason: DraftRejectedReason;
  /** For `incomplete`: what the draft still lacks, as the server listed it. */
  missing?: ServerMissing[];
};

/** Why the server refused a change for good. */
export function draftReasonFor(error: ApiError): DraftRejectedReason {
  switch (error.code) {
    case "draft_converted":
      return "converted";
    case "draft_incomplete":
      return "incomplete";
    case "draft_line_duplicate":
      return "duplicateLine";
    case "draft_limit_reached":
    case "draft_line_limit_reached":
    case "ingredient_limit_reached":
      return "limit";
    case "draft_line_name_taken":
    case "ingredient_name_taken":
      return "nameTaken";
    default:
      return reasonFor(error);
  }
}

/** The `missing` list of a `draft_incomplete` error, keeping only well-formed entries. */
export function missingOf(error: ApiError): ServerMissing[] {
  const raw = error.details?.missing;
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is ServerMissing => {
    if (typeof m !== "object" || m === null) return false;
    const { code } = m as { code?: unknown };
    return code === "name" || code === "sizes" || code === "lines" || code === "line_price" || code === "line_ingredient_missing";
  });
}

export type DraftSyncCycleDeps = {
  getToken: () => Promise<string | null>;
  listDrafts: (token: string, projectId: string) => Promise<{ drafts: Draft[]; convertedTotal?: number }>;
  /** The project's cached list (the server's, no waiting changes); null when it was never fetched. */
  getEntry: (projectId: string) => Draft[] | null;
  /** Shows and saves one project's list. Writes are applied in the order given. */
  commit: (projectId: string, list: Draft[], convertedTotal?: number) => Promise<unknown>;
  setNotice: (notice: DraftRejectedNotice) => void;
  /** Changes when the session ends or the person changes; late results are then dropped. */
  getGeneration: () => number;
  /** True after the person's own sign-out: nothing may be written. */
  isWiped: () => boolean;
  onNotSignedIn: () => void;
};

export function createDraftSyncCycle(deps: DraftSyncCycleDeps) {
  let applyChain: Promise<unknown> = Promise.resolve();
  const marked = new Set<string>();

  const draftIdOf = (change: Change) => (change.entity === DRAFT_LINE_ENTITY ? String(change.data.draftId) : change.entityId);

  const handlers = {
    onApplied: (change: Change, response: unknown) => {
      applyChain = applyChain.then(async () => {
        if (deps.isWiped()) return;
        const projectId = String(change.data.projectId);
        const entry = deps.getEntry(projectId);
        if (change.kind === "delete") {
          if (entry) {
            await deps.commit(
              projectId,
              change.entity === DRAFT_LINE_ENTITY ? withoutDraftLine(entry, draftIdOf(change), change.entityId) : withoutDraft(entry, change.entityId),
            );
          }
          return;
        }
        // A reply for a project that was never fetched would make a one-item list; the refresh brings the rest.
        if (entry === null) {
          marked.add(projectId);
          return;
        }
        if (isDraft(response)) await deps.commit(projectId, withDraft(entry, response));
        else marked.add(projectId);
      });
    },
    onRejected: (change: Change, error: ApiError) => {
      applyChain = applyChain.then(() => {
        if (deps.isWiped()) return;
        const projectId = String(change.data.projectId);
        const entry = deps.getEntry(projectId);
        const known = entry?.find((d) => d.id === draftIdOf(change))?.name;
        const name = known ?? (typeof change.data.name === "string" ? change.data.name : null);
        const entity: DraftRejectedNotice["entity"] =
          change.entity === DRAFT_STATUS_ENTITY ? "draftStatus" : change.entity === DRAFT_ENTITY ? "draft" : "draftLine";
        const reason = draftReasonFor(error);
        deps.setNotice({ entity, kind: change.kind, name, reason, ...(reason === "incomplete" ? { missing: missingOf(error) } : {}) });
        marked.add(projectId);
      });
    },
  };

  async function refresh(projectId: string): Promise<DraftRefreshResult> {
    const gen = deps.getGeneration();
    const token = await deps.getToken();
    if (!token || gen !== deps.getGeneration()) return "skipped";
    try {
      const { drafts, convertedTotal } = await deps.listDrafts(token, projectId);
      if (gen !== deps.getGeneration()) return "skipped";
      await deps.commit(projectId, drafts.filter(isDraft), typeof convertedTotal === "number" ? convertedTotal : undefined);
      return "ok";
    } catch (error) {
      if (gen !== deps.getGeneration()) return "skipped";
      if (error instanceof ApiError && error.code === "not_signed_in") {
        deps.onNotSignedIn();
        return "skipped";
      }
      if (error instanceof ApiError && error.status === 404) {
        // The project is gone or the person left it: its drafts are no longer theirs to see.
        await deps.commit(projectId, []);
        return "gone";
      }
      return error instanceof ApiError && error.code === "network" ? "offline" : "error";
    }
  }

  async function refreshPending(): Promise<void> {
    await applyChain;
    const ids = [...marked];
    marked.clear();
    for (const projectId of ids) {
      const result = await refresh(projectId);
      if (result === "offline" || result === "error") marked.add(projectId);
    }
  }

  return {
    handlers,
    refresh,
    refreshPending,
    /** Resolves when every result received so far has been applied. */
    idle: () => applyChain.then(() => undefined),
    /** Forget pending refreshes (the session ended). */
    reset: () => marked.clear(),
  };
}
