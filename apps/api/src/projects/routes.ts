import { Router } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { isUniqueViolation } from "../http/prisma-errors.js";

const nameSchema = z.string().trim().min(1).max(80);
const descriptionSchema = z.string().trim().max(500);
const currencySchema = z.enum(["VND", "USD"]);
// Accepts "Z" and offsets such as "+07:00".
const editedAtSchema = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const createSchema = z
  .object({
    id: z.uuid(),
    name: nameSchema,
    currency: currencySchema,
    description: descriptionSchema.default(""),
    editedAt: editedAtSchema,
  })
  .strict();

/** One field change from the phone: the new value and when the person made it. */
const change = <T extends z.ZodType>(value: T) =>
  z.object({ value, editedAt: editedAtSchema }).strict();

const patchSchema = z
  .object({
    fields: z
      .object({
        name: change(nameSchema).optional(),
        description: change(descriptionSchema).optional(),
        currency: change(currencySchema).optional(),
      })
      .strict()
      .refine((f) => Object.keys(f).length > 0, "At least one field is required."),
  })
  .strict();

const idSchema = z.uuid();

type Role = "owner" | "member";

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  currency: "VND" | "USD";
}

/** The exact shape the mobile app expects. */
function toResponse(project: ProjectRow, role: Role) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    currency: project.currency,
    role,
  };
}

function notFound(): AppError {
  return new AppError(404, "not_found", "Project not found.");
}

/** The project plus the caller's role, or null when it doesn't exist or the caller isn't a member. */
export async function findForMember(
  db: Pick<PrismaClient, "projectMember">,
  id: string,
  userId: string,
) {
  const membership = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: id, userId } },
    include: { project: true },
  });
  return membership ? { project: membership.project, role: membership.role } : null;
}

export function createProjectsRouter(deps: {
  prisma: PrismaClient;
  now: () => Date;
}): Router {
  const { prisma, now } = deps;
  const router = Router();
  router.use(requireAuth(deps));

  /**
   * Resolves `:id` for an owner-only action. A missing project, a non-uuid id and a
   * project the caller isn't in all give the same 404 so nothing is revealed.
   */
  async function requireOwner(rawId: string | undefined, userId: string): Promise<string> {
    const parsed = idSchema.safeParse(rawId);
    if (!parsed.success) throw notFound();
    const found = await findForMember(prisma, parsed.data, userId);
    if (!found) throw notFound();
    if (found.role !== "owner") {
      throw new AppError(403, "forbidden", "Only the owner can do this.");
    }
    return parsed.data;
  }

  router.get("/", async (_req, res, next) => {
    try {
      const memberships = await prisma.projectMember.findMany({
        where: { userId: getAuth(res.locals).userId },
        include: { project: true },
        // projectId breaks ties so same-named projects keep a stable order.
        orderBy: [{ project: { name: "asc" } }, { projectId: "asc" }],
      });
      res.json(memberships.map((m) => toResponse(m.project, m.role)));
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const userId = getAuth(res.locals).userId;
      // A phone can't set a time in the server's future, or its edits would beat every later one.
      const editedAt = new Date(Math.min(body.editedAt.getTime(), now().getTime()));

      const createOnce = () =>
        prisma.$transaction(async (tx) => {
          const existing = await tx.project.findUnique({
            where: { id: body.id },
            include: { members: { where: { userId } } },
          });
          if (existing) {
            if (existing.members.length === 0) {
              throw new AppError(409, "id_conflict", "That project id is already taken.");
            }
            return { status: 200, project: existing, role: existing.members[0]!.role };
          }
          const project = await tx.project.create({
            data: {
              id: body.id,
              name: body.name,
              description: body.description,
              currency: body.currency,
              nameEditedAt: editedAt,
              descriptionEditedAt: editedAt,
              currencyEditedAt: editedAt,
              members: { create: { userId, role: "owner" } },
            },
          });
          return { status: 201, project, role: "owner" as const };
        });

      let result;
      try {
        result = await createOnce();
      } catch (err) {
        // An identical create ran at the same moment and won. Run again: the project
        // now exists, so this returns 200 (same person) or 409 (someone else).
        if (!isUniqueViolation(err)) throw err;
        result = await createOnce();
      }
      res.status(result.status).json(toResponse(result.project, result.role));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const parsedId = idSchema.safeParse(req.params["id"]);
      // Check the id first so a bad id is a 404 even when the body is also wrong.
      if (!parsedId.success) throw notFound();
      const { fields } = patchSchema.parse(req.body);
      const id = await requireOwner(parsedId.data, userId);

      // Last write wins per field, all in one transaction. The column names come from the
      // field names, so TypeScript can't check them here; the route tests do.
      await prisma.$transaction((tx) =>
        applyLastWriteWins(fields, now(), (where, data) =>
          tx.project.updateMany({ where: { id, ...where }, data } as Prisma.ProjectUpdateManyArgs),
        ),
      );

      // Always answer with the current state, even when every change lost.
      const current = await findForMember(prisma, id, userId);
      if (!current) throw notFound(); // deleted meanwhile
      res.json(toResponse(current.project, current.role));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      const id = await requireOwner(req.params["id"], getAuth(res.locals).userId);
      // Memberships are removed by the database cascade.
      const { count } = await prisma.project.deleteMany({ where: { id } });
      if (count === 0) throw notFound(); // someone else deleted it first
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
