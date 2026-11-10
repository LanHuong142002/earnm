import "dotenv/config";
import { createApp } from "./app.js";
import { createPrismaClient } from "./db.js";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const trustProxyRaw = process.env["TRUST_PROXY"] ?? "0";
if (!/^\d+$/.test(trustProxyRaw)) {
  console.error("TRUST_PROXY must be a non-negative integer (the number of proxy hops).");
  process.exit(1);
}
const trustProxy = Number(trustProxyRaw);

const prisma = createPrismaClient(databaseUrl);
const app = createApp({ prisma, now: () => new Date(), trustProxy });

const port = Number(process.env["PORT"] ?? 3000);
app.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});
