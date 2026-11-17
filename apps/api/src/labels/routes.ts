import { Router, type Request } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { singleLineText } from "../http/text.js";
import { findForMember, lockProject } from "../projects/access.js";
import { nameKey } from "./nameKey.js";

/** A project holds at most this many labels. */
export const MAX_LABELS_PER_PROJECT = 50;

const nameSchema = singleLineText(30);
const colourSchema = z.enum(["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple"]);
// Accepts "Z" and offsets such as "+07:00".
const editedAtSchema = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const createSchema = z
  .object({ id: z.uuid(), name: nameSchema, colour: colourSchema, editedAt: editedAtSchema })
  .strict();

/** One field change from the phone: the new value and when the person made it. */
const change = <T extends z.ZodType>(value: T) =>
  z.object({ value, editedAt: editedAtSchema }).strict();

const patchSchema = z
  .object({
    fields: z
      .object({
        name: change(nameSchema).optional(),
        colour: change(colourSchema).optional(),
      })
      .strict()
      .refine((f) => Object.keys(f).length > 0, "At least one field is required."),
  })
  .strict();

const idSchema = z.uuid();

type LabelRow = { id: string; name: string; colour: string };

/** The exact shape the mobile app expects. */
function toResponse(label: LabelRow) {
  return { id: label.id, name: label.name, colour: label.colour };
}

/** Route params, including the `:projectId` merged in from the parent mount. */
function param(req: Request, name: string): string | undefined {
  return (req.params as Record<string, string | undefined>)[name];
}

/** One 404 for every "no such thing for you" case, so the body never reveals which it was. */
function notFound(): AppError {
  return new AppError(404, "not_found", "Project not found.");
}

function nameTaken(): AppError {
  return new AppError(409, "label_name_taken", "A label in this project already has that name.");
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export function createLabelsRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
  const { prisma, now } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  /** The caller's membership in `:projectId`. A bad id, a missing project and a non-member give one 404. */
  async function requireMember(rawProjectId: string | undefined, userId: string) {
    const parsed = idSchema.safeParse(rawProjectId);
    if (!parsed.success) throw notFound();
    const found = await findForMember(prisma, parsed.data, userId);
    if (!found) throw notFound();
    return { projectId: parsed.data, role: found.role };
  }

  /** The label in this project, or a 404 that looks the same whether it's missing or elsewhere. */
  async function requireLabel(rawLabelId: string | undefined, projectId: string) {
    const parsed = idSchema.safeParse(rawLabelId);
    if (!parsed.success) throw notFound();
    const label = await prisma.label.findFirst({ where: { id: parsed.data, projectId } });
    if (!label) throw notFound();
    return label;
  }

  /** Takes the project lock and re-checks the caller's membership under it. */
  async function lockedRole(tx: Tx, projectId: string, userId: string) {
    if (!(await lockProject(tx, projectId))) throw notFound();
    const member = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw notFound();
    return member.role;
  }

  router.get("/", async (req, res, next) => {
    try {
      const { projectId } = await requireMember(param(req, "projectId"), getAuth(res.locals).userId);
      const labels = await prisma.label.findMany({
        where: { projectId },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      res.json(labels.map(toResponse));
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId } = await requireMember(param(req, "projectId"), userId);
      const body = createSchema.parse(req.body);
      // A phone can't set a time in the server's future, or its edits would beat every later one.
      const editedAt = new Date(Math.min(body.editedAt.getTime(), now().getTime()));
      const key = nameKey(body.name);

      const createOnce = () =>
        prisma.$transaction(async (tx) => {
          await lockedRole(tx, projectId, userId);
          const existing = await tx.label.findUnique({ where: { id: body.id } });
          if (existing) {
            if (existing.projectId !== projectId) {
              throw new AppError(409, "id_conflict", "That label id is already taken.");
            }
            return { status: 200, label: existing };
          }
          // Counted under the project lock, so concurrent creates can't pass the limit together.
          if ((await tx.label.count({ where: { projectId } })) >= MAX_LABELS_PER_PROJECT) {
            throw new AppError(
              409,
              "label_limit_reached",
              `A project can hold at most ${MAX_LABELS_PER_PROJECT} labels.`,
            );
          }
          if (await tx.label.findUnique({ where: { projectId_nameKey: { projectId, nameKey: key } } })) {
            throw nameTaken();
          }
          const label = await tx.label.create({
            data: {
              id: body.id,
              projectId,
              name: body.name,
              nameKey: key,
              colour: body.colour,
              nameEditedAt: editedAt,
              colourEditedAt: editedAt,
            },
          });
          return { status: 201, label };
        });

      let result;
      try {
        result = await createOnce();
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // The name index means another label has the name; otherwise an identical create won.
        result = await createOnce().catch((e: unknown) => {
          throw isUniqueViolation(e) ? nameTaken() : e;
        });
      }
      res.status(result.status).json(toResponse(result.label));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:labelId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId } = await requireMember(param(req, "projectId"), userId);
      const { id: labelId } = await requireLabel(param(req, "labelId"), projectId);
      const { fields } = patchSchema.parse(req.body);

      try {
        await prisma.$transaction(async (tx) => {
          await lockedRole(tx, projectId, userId);
          await applyLastWriteWins(fields, now(), async (where, data) => {
            const scope = { id: labelId, projectId, ...where };
            if ("name" in data) {
              // Only a rename that would be applied is checked against the other labels.
              if ((await tx.label.count({ where: scope })) !== 1) return;
              const key = nameKey(data["name"] as string);
              const clash = await tx.label.findFirst({
                where: { projectId, nameKey: key, id: { not: labelId } },
              });
              if (clash) throw nameTaken(); // rolls back the whole request
              await tx.label.updateMany({ where: scope, data: { ...data, nameKey: key } } as Prisma.LabelUpdateManyArgs);
              return;
            }
            await tx.label.updateMany({ where: scope, data } as Prisma.LabelUpdateManyArgs);
          });
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw nameTaken();
        throw err;
      }

      // Always answer with the current state, even when every change lost.
      const current = await prisma.label.findFirst({ where: { id: labelId, projectId } });
      if (!current) throw notFound(); // deleted meanwhile
      res.json(toResponse(current));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:labelId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId } = await requireMember(param(req, "projectId"), userId);
      const label = await requireLabel(param(req, "labelId"), projectId);
      await prisma.$transaction(async (tx) => {
        // The role is read again under the lock: a demotion that committed meanwhile counts.
        const role = await lockedRole(tx, projectId, userId);
        if (role !== "owner") throw new AppError(403, "forbidden", "Only the owner can do this.");
        // The label's rows on tasks are removed by the database cascade.
        const { count } = await tx.label.deleteMany({ where: { id: label.id, projectId } });
        if (count === 0) throw notFound(); // someone else deleted it first
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
