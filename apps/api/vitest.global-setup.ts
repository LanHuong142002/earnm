import { execFileSync } from "node:child_process";
import { config } from "dotenv";

// The test database is shared state: tests truncate tables, so only ONE test run may use
// it at a time. Two concurrent runs cause unique and foreign-key failures that move around.
export default function setup(): void {
  config({ quiet: true });
  const testUrl = process.env["TEST_DATABASE_URL"];
  if (!testUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Add it to apps/api/.env, pointing to a separate empty PostgreSQL database.",
    );
  }
  if (testUrl === process.env["DATABASE_URL"]) {
    throw new Error(
      "TEST_DATABASE_URL must not equal DATABASE_URL. Tests truncate tables and need their own database.",
    );
  }
  // Apply migrations to the test database only.
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["prisma", "migrate", "deploy", "--config", "prisma7.config.ts"],
    {
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
}
