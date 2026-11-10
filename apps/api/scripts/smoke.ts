import { runSmoke } from "../src/ops/smoke.js";

const rawBase = process.env["API_BASE_URL"];
if (!rawBase) {
  console.error("API_BASE_URL is not set. Set it to the API's base URL, e.g. https://your-api.onrender.com");
  process.exit(1);
}
const baseUrl = rawBase.replace(/\/+$/, "");
const secret = process.env["INTERNAL_SECRET"] || undefined;

const results = await runSmoke({ baseUrl, ...(secret !== undefined ? { secret } : {}) });
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}: ${r.detail}`);
}
if (secret === undefined) {
  console.log("SKIP tick-accepts-secret: INTERNAL_SECRET is not set");
}
process.exit(results.some((r) => !r.ok) ? 1 : 0);
