import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../http/errors.js";
import { dummyVerify, hashPassword, verifyPassword } from "./password.js";
import {
  type AttemptHandle,
  createSignInLimiter, createSignUpLimiter,
} from "./rate-limit.js";
import { getAuth, requireAuth } from "./require-auth.js";
import { createSession, generateToken, revokeSession } from "./sessions.js";

export interface AuthRouterDeps {
  prisma: PrismaClient;
  now: () => Date;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  language: string | null;
}

export function toPublicUser(user: {
  id: string;
  email: string;
  displayName: string;
  language: string | null;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    language: user.language,
  };
}

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const passwordSchema = z.string().min(8).max(128);

const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(50),
});

const signInSchema = z.object({
  email: emailSchema,
  // Not length-limited tightly: a wrong-length password is just a wrong password.
  password: z.string().max(1024),
});

function tooManyAttempts(): AppError {
  return new AppError(429, "too_many_attempts", "Too many attempts. Try again later.");
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "P2002";
}

export function createAuthRouter({ prisma, now }: AuthRouterDeps): Router {
  const router = Router();
  const limiter = createSignInLimiter({ now });
  const signUpLimiter = createSignUpLimiter({ now });

  router.post("/sign-up", async (req, res, next) => {
    try {
      // Only attempts with a valid body count toward the per-IP limit.
      const { email, password, displayName } = signUpSchema.parse(req.body);
      const handle = signUpLimiter.tryAcquire({ email: "", ip: req.ip ?? "unknown" });
      if (!handle) throw tooManyAttempts();
      signUpLimiter.fail(handle);
      const passwordHash = await hashPassword(password);
      const { token, tokenHash } = generateToken();
      let user;
      try {
        user = await prisma.user.create({
          data: {
            email,
            passwordHash,
            displayName,
            sessions: { create: { tokenHash, lastUsedAt: now() } },
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError(409, "email_in_use", "That email is already in use.");
        }
        throw err;
      }
      res.status(201).json({ token, user: toPublicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/sign-in", async (req, res, next) => {
    let handle: AttemptHandle | null = null;
    try {
      const { email, password } = signInSchema.parse(req.body);
      handle = limiter.tryAcquire({ email, ip: req.ip ?? "unknown" });
      if (!handle) throw tooManyAttempts();
      const user = await prisma.user.findUnique({ where: { email } });
      const ok = user
        ? await verifyPassword(password, user.passwordHash)
        : await dummyVerify(password);
      if (!user || !ok) {
        limiter.fail(handle);
        throw new AppError(401, "invalid_credentials", "Wrong email or password.");
      }
      const token = await createSession(prisma, user.id, now());
      res.status(200).json({ token, user: toPublicUser(user) });
    } catch (err) {
      next(err);
    } finally {
      // No-op after fail(); frees the reserved slot on success or any thrown error.
      if (handle) limiter.release(handle);
    }
  });

  router.post("/sign-out", requireAuth({ prisma, now }), async (_req, res, next) => {
    try {
      await revokeSession(prisma, getAuth(res.locals).sessionId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
