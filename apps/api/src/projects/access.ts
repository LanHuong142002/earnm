import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../http/errors.js";

const idSchema = z.uuid();

/** The Prisma client or a transaction client; both have what these helpers use. */
type MemberDb = Pick<PrismaClient, "projectMember">;
type LockDb = Pick<PrismaClient, "$queryRaw">;

function notFound(): AppError {
  return new AppError(404, "not_found", "Project not found.");
}

/** The project plus the caller's role, or null when it doesn't exist or the caller isn't a member. */
export async function findForMember(db: MemberDb, id: string, userId: string) {
  const membership = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: id, userId } },
    include: { project: true },
  });
  return membership ? { project: membership.project, role: membership.role } : null;
}

/**
 * Resolves `:id` for an owner-only action. A missing project, a non-uuid id and a
 * project the caller isn't in all give the same 404 so nothing is revealed.
 */
export async function requireOwner(
  db: MemberDb,
  rawId: string | undefined,
  userId: string,
): Promise<string> {
  const parsed = idSchema.safeParse(rawId);
  if (!parsed.success) throw notFound();
  const found = await findForMember(db, parsed.data, userId);
  if (!found) throw notFound();
  if (found.role !== "owner") {
    throw new AppError(403, "forbidden", "Only the owner can do this.");
  }
  return parsed.data;
}

/**
 * Takes a row lock on the project until the transaction ends, so membership changes on
 * one project run one at a time. Returns whether the project exists.
 */
export async function lockProject(tx: LockDb, projectId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
  return rows.length > 0;
}
