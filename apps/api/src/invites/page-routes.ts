import { Router, type Response } from "express";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { createSignInLimiter } from "../auth/rate-limit.js";
import { hashCode, normalizeCode } from "./code.js";
import { pickLanguage, renderInvitePage } from "./page.js";

/** Page lookups per IP in a 15 minute window; every lookup counts, hit or miss. */
const PAGE_IP_LIMIT = 60;

function sendHtml(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      "X-Content-Type-Options": "nosniff",
    })
    .send(html);
}

export function createInvitePageRouter(deps: {
  prisma: PrismaClient;
  now: () => Date;
  inviteKey: Buffer;
  installUrl: string | null;
}): Router {
  const { prisma, now, inviteKey, installUrl } = deps;
  const router = Router();
  const limiter = createSignInLimiter({
    now,
    pairLimit: Infinity,
    emailLimit: Infinity,
    ipLimit: PAGE_IP_LIMIT,
  });

  router.get("/i/:code", async (req, res, next) => {
    try {
      const lang = pickLanguage(req.get("Accept-Language"));
      const generic = renderInvitePage({ lang, invite: null, installUrl });
      const handle = limiter.tryAcquire({ email: "", ip: req.ip ?? "unknown" });
      if (!handle) {
        sendHtml(res, 429, generic);
        return;
      }
      limiter.fail(handle);
      const raw = req.params["code"];
      const code = typeof raw === "string" ? normalizeCode(raw) : null;
      const row = code
        ? await prisma.invite.findFirst({
            where: {
              codeHash: hashCode(code, inviteKey),
              usedAt: null,
              revokedAt: null,
              expiresAt: { gt: now() },
            },
            select: {
              expiresAt: true,
              project: { select: { name: true } },
              createdBy: { select: { displayName: true } },
            },
          })
        : null;
      if (!code || !row) {
        sendHtml(res, 404, generic);
        return;
      }
      sendHtml(
        res,
        200,
        renderInvitePage({
          lang,
          invite: {
            projectName: row.project.name,
            inviterName: row.createdBy?.displayName ?? null,
            code,
            expiresAt: row.expiresAt,
          },
          installUrl,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
}
