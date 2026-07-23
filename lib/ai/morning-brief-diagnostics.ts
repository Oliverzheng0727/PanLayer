const DIAGNOSTIC_LIMIT = 600;

const SECRET_NAME = "(?:[A-Za-z][A-Za-z0-9_-]*?(?:api[_-]?key|token|secret)|api[_-]?key|authorization|token|secret)";
const QUOTED_SECRET_VALUE = `"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'`;
const SECRET_ASSIGNMENT = new RegExp(`(?:["'](${SECRET_NAME})["']|\\b(${SECRET_NAME})\\b)\\s*(?:=|:)\\s*(?:Bearer\\s+)?(?:${QUOTED_SECRET_VALUE}|[^\\s,;}\\]]+)`, "gi");
const BEARER_CREDENTIAL = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_CREDENTIAL = /\b(?:sk|rk|pk)[_-][A-Za-z0-9_-]+\b/g;
const OPAQUE_TOKEN = /\b[A-Za-z0-9+/_=-]{20,}\b/g;

export function sanitizeMorningBriefDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const sanitized = raw
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, " ")
    .replace(SECRET_ASSIGNMENT, "$1$2=[redacted]")
    .replace(BEARER_CREDENTIAL, "Bearer [redacted]")
    .replace(KEY_CREDENTIAL, "[redacted]")
    .replace(OPAQUE_TOKEN, "[redacted]")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized.length <= DIAGNOSTIC_LIMIT ? sanitized : `${sanitized.slice(0, DIAGNOSTIC_LIMIT)}…`;
}
