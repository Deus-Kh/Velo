import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Roadmap §8.1 A12 — the interface speaks plain words. No task id, no
 * protocol or infrastructure term may appear in a user-facing string
 * (string literals with a space in them, and JSX text) in the screens,
 * the components and the shared message tables. Identifiers, storage keys
 * and comments are not user-facing and are not scanned. The Advanced
 * section (B9) will get its own allowance when it exists.
 */
const ROOT = join(__dirname, '..');
const SCANNED = [
  'screens',
  'components',
  join('shared', 'chat', 'protocolErrors.ts'),
  join('shared', 'chat', 'sessionHealthPresentation.ts'),
  // C1: copy that moved out of the screens into pure helpers and hooks
  join('shared', 'chat', 'presence.ts'),
  join('shared', 'chat', 'replyPreview.ts'),
  join('shared', 'chat', 'messageListItems.ts'),
  join('shared', 'chat', 'conversationList.ts'),
  join('shared', 'chat', 'useConversationList.ts'),
  join('shared', 'chat', 'useGroupList.ts'),
  join('shared', 'settings'),
];
const JARGON = /T\d+\.\d+|\bFCM\b|ratchet|pre-?keys?\b|sender keys?\b|master key|\bepochs?\b|X3DH|HKDF|libsignal|double ratchet|diffie[- ]hellman/i;

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === '__tests__') continue;
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Drops block comments and line comments that are not inside a string on that line. */
function stripComments(source: string): string {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlocks
    .split('\n')
    .map((line) => {
      let i = 0;
      const quotes: Record<string, number> = { "'": 0, '"': 0, '`': 0 };
      while (i < line.length) {
        const ch = line[i]!;
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch in quotes) quotes[ch] = (quotes[ch] ?? 0) + 1;
        if (ch === '/' && line[i + 1] === '/' && Object.values(quotes).every((n) => n % 2 === 0)) return line.slice(0, i);
        i += 1;
      }
      return line;
    })
    .join('\n');
}

/** User-facing candidates: quoted strings containing a space, and JSX text nodes. */
function userFacingStrings(source: string): string[] {
  const out: string[] = [];
  const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const m of source.matchAll(literal)) {
    const text = m[1] ?? m[2] ?? m[3] ?? '';
    if (text.includes(' ')) out.push(text);
  }
  // JSX text: after a tag, up to the next tag or expression (may span lines); after an expression,
  // only on the same line, so that code between a closing brace and the next JSX is not read as text
  for (const m of source.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)(?=<|\{)|\}([^<>{}\n]*[A-Za-z][^<>{}\n]*)(?=<|\{)/g)) out.push((m[1] ?? m[2] ?? '').trim());
  return out;
}

describe('interface copy', () => {
  it('the scanner sees quoted strings and JSX text but not identifiers, keys or comments', () => {
    const sample = [
      "const service = `signed-prekey:${userId}`; // T1.3 keeps the ratchet key here",
      "/* the FCM token lives in the store */",
      "const label = 'Sessions use the Double Ratchet';",
      '<Text>epoch {n}</Text><Text>Members: {m}</Text>',
    ].join('\n');
    const strings = userFacingStrings(stripComments(sample));
    expect(strings).toEqual(['Sessions use the Double Ratchet', 'epoch', 'Members:']);
    expect(strings.filter((t) => JARGON.test(t))).toEqual(['Sessions use the Double Ratchet', 'epoch']);
  });

  it('carries no task ids or protocol / infrastructure jargon', () => {
    const offenders: string[] = [];
    for (const entry of SCANNED) {
      const full = join(ROOT, entry);
      const files = statSync(full).isDirectory() ? listFiles(full) : [full];
      for (const file of files) {
        const source = stripComments(readFileSync(file, 'utf8'));
        for (const text of userFacingStrings(source)) {
          const hit = text.match(JARGON);
          if (hit) offenders.push(`${relative(ROOT, file)}: "${text.slice(0, 90)}" (${hit[0]})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
