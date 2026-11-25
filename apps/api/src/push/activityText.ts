import type { ActivityType } from "../../generated/prisma/client.js";

export type ActivityLanguage = "vi" | "en";

export interface ActivityLine {
  type: ActivityType;
  actorName: string | null;
  subjectTitle: string;
  /** The person who joined, for member_joined. */
  memberName: string | null;
}

const MAX_LINES = 3;

const SOMEONE: Record<ActivityLanguage, string> = { vi: "Ai đó", en: "Someone" };

const TEXT: Record<ActivityLanguage, Record<ActivityType, (who: string, title: string) => string>> = {
  vi: {
    assigned: (who, title) => `${who} đã giao cho bạn ${title}`,
    comment: (who, title) => `${who} đã bình luận trong ${title}`,
    done: (who, title) => `${who} đã hoàn thành ${title}`,
    idea: (who, title) => `${who} đã thêm ý tưởng ${title}`,
    member_joined: (who) => `${who} đã vào dự án`,
  },
  en: {
    assigned: (who, title) => `${who} assigned you ${title}`,
    comment: (who, title) => `${who} commented on ${title}`,
    done: (who, title) => `${who} finished ${title}`,
    idea: (who, title) => `${who} added the idea ${title}`,
    member_joined: (who) => `${who} joined the project`,
  },
};

/** One notification for a batch of events: the project name as title, up to 3 lines (newest first), then "+N more". */
export function buildActivityMessage(
  lang: ActivityLanguage,
  projectName: string,
  lines: readonly ActivityLine[],
): { title: string; body: string } {
  const texts = lines.slice(0, MAX_LINES).map((line) => {
    const who =
      (line.type === "member_joined" ? line.memberName : line.actorName)?.trim() || SOMEONE[lang];
    return TEXT[lang][line.type](who, line.subjectTitle);
  });
  const more = lines.length - MAX_LINES;
  if (more > 0) texts.push(lang === "vi" ? `+${more} nữa` : `+${more} more`);
  return { title: projectName, body: texts.join("\n") };
}
