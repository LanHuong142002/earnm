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
  const mainUrl = process.env["DATABASE_URL"];
  if (testUrl === mainUrl) {
    throw new Error(
      "TEST_DATABASE_URL must not equal DATABASE_URL. Tests truncate tables and need their own database.",
    );
  }
  let parsedTest: URL;
  try {
    parsedTest = new URL(testUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL.");
  }
  const testDb = parsedTest.pathname.replace(/^\//, "");
  if (!testDb.endsWith("_test")) {
    throw new Error(
      "TEST_DATABASE_URL must point to a database whose name ends with _test, because tests truncate tables.",
    );
  }
  if (mainUrl) {
    try {
      const parsedMain = new URL(mainUrl);
      if (
        parsedMain.host === parsedTest.host &&
        parsedMain.pathname.replace(/^\//, "") === testDb
      ) {
        throw new Error("same");
      }
    } catch (e) {
      if (e instanceof Error && e.message === "same") {
        throw new Error(
          "TEST_DATABASE_URL points to the same host, port and database as DATABASE_URL. Tests truncate tables and need their own database.",
        );
      }
      // DATABASE_URL isn't a parseable URL; the string comparison above is all we can do.
    }
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
