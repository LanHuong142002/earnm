import type { RequestHandler } from "express";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../http/errors.js";
import { resolveSession } from "./sessions.js";

const MAX_TOKEN_LENGTH = 200;

export interface AuthLocals {
  userId: string;
  sessionId: string;
}

/** Reads the signed-in user set by requireAuth from `res.locals`. */
export function getAuth(locals: Record<string, unknown>): AuthLocals {
  return locals["auth"] as AuthLocals;
}

function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^bearer (\S+)$/i.exec(header);
  const token = match?.[1];
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

/**
 * Requires `Authorization: Bearer <token>`. On success sets
 * `res.locals.auth = { userId, sessionId }`; otherwise passes
 * AppError(401, "not_signed_in") to next. Tokens are never logged.
 */
export function requireAuth(deps: {
  prisma: PrismaClient;
  now: () => Date;
}): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = parseBearer(req.headers.authorization);
      const session = token
        ? await resolveSession(deps.prisma, token, deps.now())
        : null;
      if (!session) {
        next(new AppError(401, "not_signed_in", "Not signed in."));
        return;
      }
      const auth: AuthLocals = { userId: session.userId, sessionId: session.id };
      res.locals["auth"] = auth;
      next();
    } catch (err) {
      next(err);
    }
  };
}
