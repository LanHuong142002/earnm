import { formatCode } from "./code.js";

export type Lang = "vi" | "en";

export interface InvitePageData {
  projectName: string;
  /** Null when the person who created the invite has since deleted their account. */
  inviterName: string | null;
  /** Normalized code, without the dash. */
  code: string;
  expiresAt: Date;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "en" only when English's best q is greater than Vietnamese's (missing = 0); otherwise "vi". */
export function pickLanguage(acceptLanguage: string | undefined): Lang {
  if (!acceptLanguage) return "vi";
  const best = { en: 0, vi: 0 };
  for (const part of acceptLanguage.split(",")) {
    const [tagRaw, ...params] = part.split(";");
    const primary = (tagRaw ?? "").trim().toLowerCase().split("-")[0];
    if (primary !== "en" && primary !== "vi") continue;
    let q = 1;
    let valid = true;
    for (const param of params) {
      const m = /^\s*q\s*=\s*(\d(?:\.\d{0,3})?)\s*$/i.exec(param);
      if (m) {
        q = Number(m[1]);
        if (q > 1) valid = false;
      } else if (/^\s*q\s*=/i.test(param)) {
        valid = false;
      }
    }
    if (valid && q > best[primary]) best[primary] = q;
  }
  return best.en > best.vi ? "en" : "vi";
}

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** vi: dd/mm/yyyy. en: 19 Nov 2026. Always in Vietnam time, whatever the server's zone. */
function formatDate(date: Date, lang: Lang): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = Number(get("day"));
  const month = Number(get("month"));
  const year = get("year");
  if (lang === "vi") {
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }
  return `${day} ${EN_MONTHS[month - 1] ?? ""} ${year}`;
}

interface Strings {
  invalidTitle: string;
  invalidBody: string;
  title: (project: string) => string;
  invitedBy: (inviter: string) => string;
  someone: string;
  codeLabel: string;
  expires: (date: string) => string;
  stepsTitle: string;
  step1: string;
  step2Link: (linkHtml: string) => string;
  step2Link_text: string;
  step2Ask: string;
  step3: string;
  step4: string;
}

// Strings returning HTML receive already-escaped values; the static text has no markup.
const STRINGS: Record<Lang, Strings> = {
  vi: {
    invalidTitle: "Lời mời không hợp lệ",
    invalidBody:
      "Lời mời này không dùng được nữa. Hãy nhờ người đã mời bạn gửi lại một mã mới.",
    title: (p) => `Bạn được mời vào dự án ${p}`,
    invitedBy: (i) => `${i} đã mời bạn tham gia.`,
    someone: "Một người dùng",
    codeLabel: "Mã mời",
    expires: (d) => `Mã có hiệu lực đến ${d}.`,
    stepsTitle: "Cách tham gia",
    step1: "Cài ứng dụng Expo Go từ App Store.",
    step2Link: (l) => `Mở ứng dụng bằng ${l}.`,
    step2Link_text: "liên kết cài đặt",
    step2Ask: "Mở ứng dụng. Hãy hỏi người đã mời bạn để lấy liên kết cài đặt.",
    step3: "Đăng ký hoặc đăng nhập.",
    step4: "Chạm “Tham gia bằng mã” và nhập mã ở trên.",
  },
  en: {
    invalidTitle: "Invite not valid",
    invalidBody:
      "This invite can no longer be used. Ask the person who invited you to send a new code.",
    title: (p) => `You're invited to ${p}`,
    invitedBy: (i) => `${i} invited you to join.`,
    someone: "Someone",
    codeLabel: "Invite code",
    expires: (d) => `This code works until ${d}.`,
    stepsTitle: "How to join",
    step1: "Install Expo Go from the App Store.",
    step2Link: (l) => `Open the app using the ${l}.`,
    step2Link_text: "install link",
    step2Ask: "Open the app. To get the install link, ask the person who invited you.",
    step3: "Sign up or sign in.",
    step4: "Tap “Join with code” and enter the code above.",
  },
};

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#FFFFFF;color:#141414;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:16px;line-height:1.5}
main{max-width:480px;margin:0 auto;padding:32px 20px 48px}
h1{font-size:24px;line-height:1.25;margin:0 0 8px;overflow-wrap:anywhere}
h2{font-size:18px;margin:32px 0 8px}
p{margin:0 0 8px;overflow-wrap:anywhere}
.muted{color:#5F5F5F}
.code{background:#FFF1EB;border-radius:12px;padding:16px;margin:24px 0 8px;text-align:center}
.code .label{display:block;color:#5F5F5F;font-size:14px}
.code .value{display:block;color:#F4511E;font-size:32px;font-weight:700;letter-spacing:4px;font-variant-numeric:tabular-nums}
ol{margin:0;padding-left:24px}
li{margin-bottom:8px}
a{color:#F4511E}
`.trim();

function document(lang: Lang, title: string, body: string): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

export function renderInvitePage(args: {
  lang: Lang;
  invite: InvitePageData | null;
  installUrl: string | null;
}): string {
  const { lang, invite, installUrl } = args;
  const s = STRINGS[lang];
  if (!invite) {
    return document(
      lang,
      s.invalidTitle,
      `<h1>${escapeHtml(s.invalidTitle)}</h1>\n<p class="muted">${escapeHtml(s.invalidBody)}</p>`,
    );
  }
  const project = escapeHtml(invite.projectName);
  const inviter = escapeHtml(invite.inviterName ?? s.someone);
  const step2 =
    installUrl !== null
      ? s.step2Link(`<a href="${escapeHtml(installUrl)}">${escapeHtml(s.step2Link_text)}</a>`)
      : escapeHtml(s.step2Ask);
  const body = `<h1>${s.title(project)}</h1>
<p class="muted">${s.invitedBy(inviter)}</p>
<div class="code"><span class="label">${escapeHtml(s.codeLabel)}</span><span class="value">${escapeHtml(formatCode(invite.code))}</span></div>
<p class="muted">${escapeHtml(s.expires(formatDate(invite.expiresAt, lang)))}</p>
<h2>${escapeHtml(s.stepsTitle)}</h2>
<ol>
<li>${escapeHtml(s.step1)}</li>
<li>${step2}</li>
<li>${escapeHtml(s.step3)}</li>
<li>${escapeHtml(s.step4)}</li>
</ol>`;
  return document(lang, s.title(invite.projectName), body);
}
