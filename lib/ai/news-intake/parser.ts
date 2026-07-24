import type { ParsedFeedItem } from "./types";

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: "\"",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity[0] === "#") {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return ENTITY_MAP[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function cleanMarkup(value: string): string {
  const withoutCdata = value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, "$1");
  return decodeEntities(withoutCdata.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(block: string, names: string[]): string {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return cleanMarkup(match[1]);
  }
  return "";
}

function parseDate(value: string): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function atomLink(block: string): string {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)];
  const candidates = links.flatMap((match) => {
    const attributes = match[1];
    const href = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    const rel = attributes.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2]?.toLowerCase() ?? "alternate";
    return href ? [{ href: decodeEntities(href).trim(), rel }] : [];
  });
  return candidates.find((item) => item.rel === "alternate")?.href ?? candidates[0]?.href ?? "";
}

export function parseFeedXml(xml: string): ParsedFeedItem[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("RSS DTD/entity declarations are not allowed");
  const isAtom = /<(?:\w+:)?feed\b/i.test(xml) || /<(?:\w+:)?entry\b/i.test(xml);
  const expression = isAtom
    ? /<(?:\w+:)?entry\b[^>]*>([\s\S]*?)<\/(?:\w+:)?entry>/gi
    : /<(?:\w+:)?item\b[^>]*>([\s\S]*?)<\/(?:\w+:)?item>/gi;
  const blocks = [...xml.matchAll(expression)].map((match) => match[1]);

  return blocks.flatMap((block) => {
    const title = tagValue(block, ["title"]);
    const url = isAtom ? atomLink(block) : tagValue(block, ["link", "guid"]);
    if (!title || !url) return [];
    const excerpt = tagValue(block, ["description", "summary", "content", "content:encoded"]);
    const date = tagValue(block, ["pubDate", "published", "updated", "dc:date"]);
    return [{
      title,
      url,
      excerpt: excerpt || null,
      publishedAt: parseDate(date),
    }];
  });
}
