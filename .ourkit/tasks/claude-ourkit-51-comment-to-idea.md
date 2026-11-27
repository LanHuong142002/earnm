# Tasks: A comment can be saved as an idea or a drink draft (#51)

Spec: `.ourkit/specs/claude-ourkit-51-comment-to-idea.md`. Plan: `.ourkit/plans/claude-ourkit-51-comment-to-idea.md`. Mockup: `.ourkit/mockups/claude-ourkit-51-comment-to-idea.html`.

## Tasks

### 1. Comment source helpers

New `apps/mobile/src/tasks/comments/commentSource.ts` with tests in `commentSource.test.ts` (write them first): `firstSentence(text)` per spec R6 (".", "!", "?", "…" followed by a space, line break or end; or the first line break; trimmed; whole text if empty; a dot inside "3.5k" is not an end); `ideaFromComment(source)` → `{ title, description }` (title cut to `TITLE_MAX` 120 at a word boundary, description = whole comment); `draftFromComment(source)` → `{ name, note }` (name cut to `DRAFT_NAME_MAX` 60 at a word boundary, note cut to `DRAFT_NOTE_MAX` 500); reuse #50's `draftNameFromTitle` cutting logic from `apps/mobile/src/ideas/draftPrefill.ts`, generalised to a max length (characters, not code units). `commentSourceParams({ text, authorName, sourceTitle })` → string route params including `fromComment: "1"`, and `readCommentSource(params)` → source or null (ignore missing/malformed, cap text at `COMMENT_MAX` 1000 and titles at 120). A source-line helper returning the i18n key and values: "Từ bình luận của {{name}} ở “{{title}}”" or the fallback "Từ một bình luận ở “{{title}}”" when the name is empty.

Depends on: none
Verify: `ourkit gate run test`

### 2. Long-press menu on comments

`apps/mobile/src/tasks/parent.ts`: optional `title?: string` on `Parent`; set it in `taskParent` and in `ideaParent` (`apps/mobile/src/ideas/adapters.ts`) and wherever those are called with the task/idea at hand. `apps/mobile/src/tasks/comments/CommentBubble.tsx`: when not editing, `onLongPress` opens a menu titled "Bình luận của <name>" with "Thêm thành ý tưởng", "Thêm thành nháp món", "Huỷ" — action sheet on iOS, Alert buttons elsewhere, the same pattern as `showSortMenu` in `CommentsSection.tsx` (extract a shared helper if it keeps both simple); and `accessibilityActions` with the two items plus `onAccessibilityAction`. Applies to own, others', waiting and failed comments (spec R1–R3). New prop `onAddAs(kind: "idea" | "draft")`. `CommentsSection.tsx`: implement `onAddAs` by `router.push` to `/projects/[id]/ideas/new` or `/projects/[id]/drafts/new` with `{ id: parent.projectId, ...commentSourceParams(...) }` (author name from the comment, `parent.title`). Strings in `i18n/vi.json` and `en.json`. Unit-test any extracted pure menu builder. Mockup C1, C1b.

Depends on: 1
Verify: `ourkit gate run test` and `ourkit gate run lint`; the gesture goes to the Test Handoff

### 3. Prefilled New idea and New draft forms

`apps/mobile/src/app/(app)/(home)/projects/[id]/ideas/new.tsx`: read `readCommentSource(useLocalSearchParams())`; when present, initialise title and description once from `ideaFromComment` and show the source line above the fields (mockup C2, C4). `apps/mobile/src/app/(app)/(home)/projects/[id]/drafts/new.tsx`: in the plain form (not the `fromIdea` path), the same with `draftFromComment` for name and note (mockup C3). Saving stays the normal create of each form (queued, offline-capable); nothing else changes. Strings in both i18n files.

Depends on: 1
Verify: `ourkit gate run test` and `ourkit gate run lint`; the screens go to the Test Handoff
