import "dotenv/config";
import { createApp } from "./app.js";
import { createCloudinaryStore } from "./photos/cloudinary.js";
import { createTimerScheduler } from "./activity/scheduler.js";
import { flushActivity } from "./push/activity.js";
import { createExpoSender } from "./push/sender.js";
import { ConfigError, loadConfig } from "./config.js";
import { createPrismaClient } from "./db.js";

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const prisma = createPrismaClient(config.databaseUrl);
const pushSender = createExpoSender({ accessToken: config.expoAccessToken });
const now = () => new Date();
const app = createApp({
  prisma,
  now,
  trustProxy: config.trustProxy,
  internalSecret: config.internalSecret,
  inviteInstallUrl: config.inviteInstallUrl,
  inviteCodeKey: config.inviteCodeKey,
  photoStore: config.cloudinary ? createCloudinaryStore(config.cloudinary) : null,
  pushSender,
  activityScheduler: pushSender
    ? createTimerScheduler(() => flushActivity({ prisma, sender: pushSender, now: now() }), now)
    : null,
});

app.listen(config.port, () => {
  console.log(`api listening on http://localhost:${config.port}`);
});
