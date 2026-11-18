import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../http/errors.js";
import { runCatchUp } from "../push/catchUp.js";
import type { PushSender } from "../push/sender.js";

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
      if (prisma && pushSender) {
        await runCatchUp({ prisma, sender: pushSender, now: (deps.now ?? (() => new Date()))() });
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
