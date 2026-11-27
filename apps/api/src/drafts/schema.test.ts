import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Checks the draft<->idea link and DraftPhoto rules in the migration text itself (ticket #50),
// so dropping the unique key, SET NULL or the cascade makes these fail.
const sql = readFileSync(
  fileURLToPath(new URL("../../prisma/migrations/20261127120000_draft_idea_photos/migration.sql", import.meta.url)),
  "utf8",
);

describe("draft idea photos migration", () => {
  it("adds a nullable ideaId to Draft with a unique index", () => {
    expect(sql).toContain('ALTER TABLE "Draft" ADD COLUMN     "ideaId" TEXT;');
    expect(sql).toContain('CREATE UNIQUE INDEX "Draft_ideaId_key" ON "Draft"("ideaId");');
  });

  it("clears Draft.ideaId when the idea is deleted", () => {
    expect(sql).toContain(
      'ALTER TABLE "Draft" ADD CONSTRAINT "Draft_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
    );
  });

  it("creates DraftPhoto with a unique publicId and a listing index", () => {
    expect(sql).toContain('CREATE TABLE "DraftPhoto"');
    expect(sql).toContain('CREATE UNIQUE INDEX "DraftPhoto_publicId_key" ON "DraftPhoto"("publicId");');
    expect(sql).toContain(
      'CREATE INDEX "DraftPhoto_draftId_createdAt_id_idx" ON "DraftPhoto"("draftId", "createdAt", "id");',
    );
  });

  it("deletes photos with their draft and keeps them when the uploader goes", () => {
    expect(sql).toContain(
      'ALTER TABLE "DraftPhoto" ADD CONSTRAINT "DraftPhoto_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;',
    );
    expect(sql).toContain(
      'ALTER TABLE "DraftPhoto" ADD CONSTRAINT "DraftPhoto_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;',
    );
  });
});
