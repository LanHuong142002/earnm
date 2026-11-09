import express, { type Express } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createAuthRouter } from "./auth/routes.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";
import { createMeRouter } from "./me/routes.js";

export interface AppDeps {
  prisma: PrismaClient;
  now: () => Date;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/auth", createAuthRouter(deps));
  app.use("/me", createMeRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
