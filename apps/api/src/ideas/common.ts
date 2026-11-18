import type { Request } from "express";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../http/errors.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { findForMember, lockProject } from "../projects/access.js";

/** Pieces shared by the idea routes, comments and photos. */

export const idSchema = z.uuid();

// Accepts "Z" and offsets such as "+07:00".
export const editedAtSchema = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

/** One field change from the phone: the new value and when the person made it. */
export const change = <T extends z.ZodType>(value: T) =>
  z.object({ value, editedAt: editedAtSchema }).strict();

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Route params, including the ones merged in from the parent mount. */
export function param(req: Request, name: string): string | undefined {
  return (req.params as Record<string, string | undefined>)[name];
}

/** One 404 for every "no such thing for you" case, so the body never reveals which it was. */
export function notFound(): AppError {
  return new AppError(404, "not_found", "Project not found.");
}

export function forbidden(message: string): AppError {
  return new AppError(403, "forbidden", message);
}

/**
 * The caller's membership in `:projectId`, and the idea in it. Every miss (a bad id, a missing
 * project, a non-member, an idea elsewhere) gives the same 404.
 */
export async function requireIdea(prisma: PrismaClient, req: Request, userId: string) {
  const projectId = idSchema.safeParse(param(req, "projectId"));
  const ideaId = idSchema.safeParse(param(req, "ideaId"));
  if (!projectId.success || !ideaId.success) throw notFound();
  const member = await findForMember(prisma, projectId.data, userId);
  if (!member) throw notFound();
  const idea = await prisma.idea.findFirst({
    where: { id: ideaId.data, projectId: projectId.data },
    select: { id: true },
  });
  if (!idea) throw notFound();
  return { projectId: projectId.data, ideaId: idea.id, role: member.role };
}

/** Takes the project lock and re-checks the caller's membership under it; returns the role. */
export async function lockedMember(tx: Tx, projectId: string, userId: string) {
  if (!(await lockProject(tx, projectId))) throw notFound();
  const member = await tx.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  if (!member) throw notFound();
  return member.role;
}

/** The idea as it is under the lock, or the same 404. */
export async function lockedIdea(tx: Tx, projectId: string, ideaId: string) {
  const idea = await tx.idea.findFirst({
    where: { id: ideaId, projectId },
    select: { id: true, authorId: true },
  });
  if (!idea) throw notFound();
  return idea;
}

/** The idea's author, or an Owner of the project. An idea whose author is gone is the Owner's alone. */
export function canManage(idea: { authorId: string | null }, userId: string, role: "owner" | "member") {
  return role === "owner" || idea.authorId === userId;
}

/** Runs `createOnce`; when an identical create won at the same moment, runs it once more. */
export async function withRetry<T>(createOnce: () => Promise<T>): Promise<T> {
  try {
    return await createOnce();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return createOnce();
  }
}
