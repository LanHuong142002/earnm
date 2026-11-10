import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { AppError } from "../http/errors.js";

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

export function createInternalRouter(deps: { internalSecret?: string }): Router {
  const router = Router();
  router.use(requireInternalSecret(deps.internalSecret));

  router.post("/tick", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/ip", (req, res) => {
    res.json({ ip: req.ip });
  });

  return router;
}
