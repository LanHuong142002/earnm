import { randomBytes } from "node:crypto";
import express, { type Express } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createAuthRouter } from "./auth/routes.js";
import { createInternalRouter } from "./internal/routes.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import { deriveInviteKey } from "./invites/code.js";
import { createInvitePageRouter } from "./invites/page-routes.js";
import { createInvitesRouter } from "./invites/routes.js";
import { createMembersRouter } from "./members/routes.js";
import { createMeRouter } from "./me/routes.js";
import { createProjectsRouter } from "./projects/routes.js";

export interface AppDeps {
  prisma: PrismaClient;
  now: () => Date;
  /** Number of reverse-proxy hops to trust for X-Forwarded-For. 0 (default) trusts none. */
  trustProxy?: number;
  /** Shared secret for /internal endpoints. When absent, internal endpoints refuse every request. */
  internalSecret?: string;
  /** Link shown on the invite web page for installing the app. Null or absent: the page says to ask the inviter. */
  inviteInstallUrl?: string | null;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.set("trust proxy", deps.trustProxy ?? 0);
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth", createAuthRouter(deps));
  app.use("/me", createMeRouter(deps));
  app.use("/projects", createProjectsRouter(deps));
  // Without INTERNAL_SECRET the key is random per process: invites work but don't survive a restart.
  const inviteKey =
    deps.internalSecret !== undefined ? deriveInviteKey(deps.internalSecret) : randomBytes(32);
  app.use(createInvitesRouter({ prisma: deps.prisma, now: deps.now, inviteKey }));
  app.use(
    createInvitePageRouter({
      prisma: deps.prisma,
      now: deps.now,
      inviteKey,
      installUrl: deps.inviteInstallUrl ?? null,
    }),
  );
  app.use(createMembersRouter(deps));

  app.use(
    "/internal",
    createInternalRouter(
      deps.internalSecret !== undefined ? { internalSecret: deps.internalSecret } : {},
    ),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
