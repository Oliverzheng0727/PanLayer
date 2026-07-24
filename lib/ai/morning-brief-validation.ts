import type { BriefBlock, MorningBrief } from "./morning-brief-contract";

export interface BriefPublicationIssue {
  code: "direction-conflict" | "stale-source" | "missing-source-time";
  message: string;
}

export interface BriefPublicationValidation {
  ok: boolean;
  expectedAt: string;
  completedAt: string;
  timeliness: "on-time" | "late";
  issues: BriefPublicationIssue[];
}

const SUBJECTS = [
  "道琼斯",
  "标普",
  "纳斯达克",
  "费城半导体",
  "英伟达",
  "美光",
  "中概",
  "富时A50",
  "韩国股市",
  "日经",
  "原油",
  "黄金",
  "人民币",
] as const;
const POSITIVE = /上涨|走高|收涨|反弹|领涨|新高|大涨|暴涨|升值/;
const NEGATIVE = /下跌|走低|收跌|回落|领跌|重挫|暴跌|大跌|贬值/;
const SEQUENCE = /一度|盘中|随后|之后|转而|冲高回落|先.*后/;

function blockTexts(block: BriefBlock): string[] {
  if (block.type === "heading" || block.type === "paragraph" || block.type === "callout") return [block.text];
  if (block.type === "bullets") return block.items.map((item) => item.text);
  return [...block.columns, ...block.rows.flat()];
}

function publicationTime(date: string, time: string) {
  return new Date(`${date}T${time}:00+08:00`);
}

export function validateBriefPublication(
  brief: MorningBrief,
  now = new Date(),
): BriefPublicationValidation {
  const issues: BriefPublicationIssue[] = [];
  const expected = publicationTime(brief.date, "07:15");
  const lateBoundary = publicationTime(brief.date, "07:30");
  const effectiveCompleted = now;
  const sentences = brief.sections
    .flatMap((section) => [section.summary, ...section.blocks.flatMap(blockTexts)])
    .flatMap((text) => text.split(/[。！？\n]+/))
    .map((text) => text.trim())
    .filter(Boolean);

  for (const subject of SUBJECTS) {
    const relevant = sentences.filter((sentence) => sentence.includes(subject) && !SEQUENCE.test(sentence));
    const positive = relevant.some((sentence) => POSITIVE.test(sentence));
    const negative = relevant.some((sentence) => NEGATIVE.test(sentence));
    if (positive && negative) {
      issues.push({
        code: "direction-conflict",
        message: `${subject}在不同模块中出现相反方向描述`,
      });
    }
  }

  for (const source of brief.sources) {
    if (!source.publishedAt) {
      issues.push({
        code: "missing-source-time",
        message: `${source.title}缺少发布时间`,
      });
      continue;
    }
    const publishedAt = new Date(source.publishedAt);
    if (!Number.isNaN(publishedAt.getTime()) && now.getTime() - publishedAt.getTime() > 36 * 60 * 60_000) {
      issues.push({
        code: "stale-source",
        message: `${source.title}发布时间超过36小时`,
      });
    }
  }

  return {
    ok: !issues.some((issue) => issue.code === "direction-conflict" || issue.code === "stale-source"),
    expectedAt: expected.toISOString(),
    completedAt: effectiveCompleted.toISOString(),
    timeliness: effectiveCompleted.getTime() <= lateBoundary.getTime() ? "on-time" : "late",
    issues,
  };
}
