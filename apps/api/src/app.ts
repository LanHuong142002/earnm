import { randomBytes } from "node:crypto";
import express, { type Express } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createAuthRouter } from "./auth/routes.js";
import { createInternalRouter } from "./internal/routes.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import { deriveInviteKey } from "./invites/code.js";
import { pickInviteKeySource } from "./invites/key-source.js";
import { createInvitePageRouter } from "./invites/page-routes.js";
import { createInvitesRouter } from "./invites/routes.js";
import { createMembersRouter } from "./members/routes.js";
import { createMeRouter } from "./me/routes.js";
import { createActivityRouter } from "./activity/routes.js";
import { createProjectsRouter } from "./projects/routes.js";
import { createChecklistsRouter } from "./checklists/routes.js";
import { createCommentsRouter } from "./comments/routes.js";
import { createProjectRemindersRouter, createRemindersRouter } from "./reminders/routes.js";
import { createPhotosRouter } from "./photos/routes.js";
import type { PhotoStore } from "./photos/cloudinary.js";
import type { PushSender } from "./push/sender.js";
import type { ActivityScheduler } from "./activity/record.js";
import { createLabelsRouter } from "./labels/routes.js";
import { createTasksRouter } from "./tasks/routes.js";
import { createIdeasRouter } from "./ideas/routes.js";
import { createVotesRouter } from "./ideas/votes.js";
import { createIdeaCommentsRouter } from "./ideas/comments.js";
import { createIdeaPhotosRouter } from "./ideas/photos.js";
import { createIdeaToTaskRouter } from "./ideas/toTask.js";
import { createIngredientsRouter } from "./ingredients/routes.js";
import { createExtraCostsRouter } from "./products/extraCosts.js";
import { createDraftConvertRouter } from "./drafts/convert.js";
import { createDraftPhotosRouter } from "./drafts/photos.js";
import { createDraftsRouter } from "./drafts/routes.js";
import { createFixedCostsRouter } from "./products/fixedCosts.js";
import { createProductsRouter } from "./products/routes.js";

export interface AppDeps {
  prisma: PrismaClient;
  now: () => Date;
  /** Number of reverse-proxy hops to trust for X-Forwarded-For. 0 (default) trusts none. */
  trustProxy?: number;
  /** Shared secret for /internal endpoints. When absent, internal endpoints refuse every request. */
  internalSecret?: string;
  /** Link shown on the invite web page for installing the app. Null or absent: the page says to ask the inviter. */
  inviteInstallUrl?: string | null;
  /** Optional key for hashing invite codes. When absent, INTERNAL_SECRET is used. */
  inviteCodeKey?: string | null;
  /** Cloudinary access for task photos. Null or absent: the photo endpoints answer 503 and the rest works. */
  photoStore?: PhotoStore | null;
  /** Sends reminder pushes on each tick. Null or absent: ticks send nothing. */
  pushSender?: PushSender | null;
  /** Told, after a commit, when the earliest new activity push comes due. Null or absent: nothing is scheduled. */
  activityScheduler?: ActivityScheduler | null;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.set("trust proxy", deps.trustProxy ?? 0);
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth", createAuthRouter(deps));
  // Checks sign-in per route, so it can sit before /me and before the /projects routers.
  app.use(createActivityRouter(deps));
  app.use("/me", createMeRouter(deps));
  // Before /projects: that router requires sign-in for everything under it, which would run twice.
  // Before the tasks router, which also requires sign-in and would otherwise run first.
  app.use("/projects/:projectId/tasks/:taskId/checklists", createChecklistsRouter(deps));
  app.use("/projects/:projectId/tasks/:taskId/comments", createCommentsRouter(deps));
  app.use("/projects/:projectId/tasks/:taskId/photos", createPhotosRouter(deps));
  app.use("/projects/:projectId/tasks/:taskId/reminders", createRemindersRouter(deps));
  app.use("/projects/:projectId/reminders", createProjectRemindersRouter(deps));
  app.use("/projects/:projectId/tasks", createTasksRouter(deps));
  // Likewise before the ideas router.
  app.use("/projects/:projectId/ideas/:ideaId/vote", createVotesRouter(deps));
  app.use("/projects/:projectId/ideas/:ideaId/comments", createIdeaCommentsRouter(deps));
  app.use("/projects/:projectId/ideas/:ideaId/photos", createIdeaPhotosRouter(deps));
  app.use("/projects/:projectId/ideas/:ideaId/task", createIdeaToTaskRouter(deps));
  app.use("/projects/:projectId/ideas", createIdeasRouter(deps));
  app.use("/projects/:projectId/ingredients", createIngredientsRouter(deps));
  app.use("/projects/:projectId/products", createProductsRouter(deps));
  app.use("/projects/:projectId/drafts/:draftId/photos", createDraftPhotosRouter(deps));
  app.use("/projects/:projectId/drafts", createDraftConvertRouter(deps));
  app.use("/projects/:projectId/drafts", createDraftsRouter(deps));
  app.use("/projects/:projectId/extra-costs", createExtraCostsRouter(deps));
  app.use("/projects/:projectId/fixed-costs", createFixedCostsRouter(deps));
  app.use("/projects/:projectId/labels", createLabelsRouter(deps));
  app.use("/projects", createProjectsRouter(deps));
  // Without INVITE_CODE_KEY or INTERNAL_SECRET the key is random per process: invites work but don't survive a restart.
  const keySource = pickInviteKeySource(deps);
  const inviteKey = keySource !== undefined ? deriveInviteKey(keySource) : randomBytes(32);
  app.use(
    createInvitesRouter({
      prisma: deps.prisma,
      now: deps.now,
      inviteKey,
      activityScheduler: deps.activityScheduler ?? null,
    }),
  );
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
    createInternalRouter({
      ...(deps.internalSecret !== undefined ? { internalSecret: deps.internalSecret } : {}),
      prisma: deps.prisma,
      pushSender: deps.pushSender ?? null,
      now: deps.now,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
