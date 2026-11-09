import express, { type Express } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";
import { errorHandler, notFoundHandler } from "./http/errors.js";

export interface AppDeps {
  prisma: PrismaClient;
  now: () => Date;
}

export function createApp(_deps: AppDeps): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
