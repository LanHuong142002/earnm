import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../http/errors.js";
import { runCatchUp } from "../push/catchUp.js";
import { flushActivity } from "../push/activity.js";
import type { PushSender } from "../push/sender.js";

const ACTIVITY_KEEP_MS = 30 * 86_400_000;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * Requires `Authorization: Bearer <secret>`. With no configured secret every request is
 * refused. Both sides are SHA-256 digested so the comparison is constant-time and
 * independent of length. Neither the header nor the secret is ever logged.
 */
export function requireInternalSecret(secret: string | undefined): RequestHandler {
  return (req, _res, next) => {
    const match = /^bearer (\S+)$/i.exec(req.headers.authorization ?? "");
    const submitted = match?.[1];
    if (
      secret === undefined ||
      submitted === undefined ||
      !timingSafeEqual(digest(submitted), digest(secret))
    ) {
      next(new AppError(401, "unauthorized", "Not authorized."));
      return;
    }
    next();
  };
}

export function createInternalRouter(deps: {
  internalSecret?: string;
  /** With both, each tick sends the reminders that came due. Without, a tick does nothing and never touches the database. */
  prisma?: PrismaClient;
  pushSender?: PushSender | null;
  now?: () => Date;
}): Router {
  const router = Router();
  router.use(requireInternalSecret(deps.internalSecret));

  router.post("/tick", async (_req, res, next) => {
    try {
      const { prisma, pushSender } = deps;
      const now = (deps.now ?? (() => new Date()))();
      if (prisma && pushSender) {
        await runCatchUp({ prisma, sender: pushSender, now });
        await flushActivity({ prisma, sender: pushSender, now });
      }
      if (prisma) {
        // Activity is kept for 30 days; the recipient rows go with their event.
        // Housekeeping only: a failure here must not fail the tick.
        try {
          await prisma.activityEvent.deleteMany({
            where: { occurredAt: { lt: new Date(now.getTime() - ACTIVITY_KEEP_MS) } },
          });
        } catch (err) {
          console.error("activity: cleanup failed", err instanceof Error ? err.name : "unknown");
        }
      }
      res.json({ status: "ok" });
    } catch (err) {
      next(err);
    }
  });

  router.get("/ip", (req, res) => {
    res.json({ ip: req.ip });
  });

  return router;
}
