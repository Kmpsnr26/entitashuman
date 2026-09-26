export type HumanALEContextTarget =
  | "reasoner"
  | "planner"
  | "agent";

export type HumanALEContextMode =
  | "ask"
  | "auto-safe";

export interface HumanALEContextSourceRecord {
  id: string;
  title: string;
  content: string;
}

export interface HumanALEContextPacket {
  version: 1;
  target: HumanALEContextTarget;
  mode: HumanALEContextMode;
  approved: true;
  count: number;
  chars: number;
  entryIds: string[];
  text: string;
}

const MAX_CONTEXT_ENTRIES =
  6;

const MAX_CONTEXT_CHARS =
  1_600;

const MAX_ENTRY_TITLE_CHARS =
  120;

const MAX_ENTRY_CONTENT_CHARS =
  220;

const CONTROL_CHARS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const SECRET_PATTERNS = [
  /\b(?:sk|sk-proj)-[A-Za-z0-9_-]{12,}\b/i,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\s*[:=]\s*[^\s,;]{6,}/i
];

function hasCredentialPattern(
  value: string
): boolean {
  return SECRET_PATTERNS.some(
    pattern =>
      pattern.test(value)
  );
}

function cleanText(
  value: string,
  max: number
): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeEntryText(
  record:
    HumanALEContextSourceRecord
): string | null {
  const source =
    record.title +
    "\n" +
    record.content;

  if (
    CONTROL_CHARS.test(
      source
    ) ||
    hasCredentialPattern(
      source
    )
  ) {
    return null;
  }

  const title =
    cleanText(
      record.title,
      MAX_ENTRY_TITLE_CHARS
    );

  const content =
    cleanText(
      record.content,
      MAX_ENTRY_CONTENT_CHARS
    );

  if (
    !title ||
    !content
  ) {
    return null;
  }

  return (
    "[" +
    title +
    "]\n" +
    content
  );
}

export function buildHumanALEContextPacket(
  records:
    HumanALEContextSourceRecord[],
  target:
    HumanALEContextTarget,
  mode:
    HumanALEContextMode
): HumanALEContextPacket | null {
  const selected:
    string[] = [];

  const entryIds:
    string[] = [];

  let chars =
    0;

  for (
    const record of
      records
  ) {
    if (
      selected.length >=
      MAX_CONTEXT_ENTRIES
    ) {
      break;
    }

    const text =
      safeEntryText(
        record
      );

    if (!text) {
      continue;
    }

    const separator =
      selected.length > 0
        ? "\n\n"
        : "";

    if (
      chars +
      separator.length +
      text.length >
      MAX_CONTEXT_CHARS
    ) {
      continue;
    }

    selected.push(
      separator + text
    );

    entryIds.push(
      record.id
    );

    chars +=
      separator.length +
      text.length;
  }

  if (
    selected.length === 0
  ) {
    return null;
  }

  const text =
    selected.join("");

  return {
    version:
      1,

    target,

    mode,

    approved:
      true,

    count:
      entryIds.length,

    chars:
      text.length,

    entryIds,

    text
  };
}

export {
  MAX_CONTEXT_CHARS,
  MAX_CONTEXT_ENTRIES
};
