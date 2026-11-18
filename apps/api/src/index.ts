import "dotenv/config";
import { createApp } from "./app.js";
import { createCloudinaryStore } from "./photos/cloudinary.js";
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
const app = createApp({
  prisma,
  now: () => new Date(),
  trustProxy: config.trustProxy,
  internalSecret: config.internalSecret,
  inviteInstallUrl: config.inviteInstallUrl,
  inviteCodeKey: config.inviteCodeKey,
  photoStore: config.cloudinary ? createCloudinaryStore(config.cloudinary) : null,
  pushSender: createExpoSender({ accessToken: config.expoAccessToken }),
});

app.listen(config.port, () => {
  console.log(`api listening on http://localhost:${config.port}`);
});
