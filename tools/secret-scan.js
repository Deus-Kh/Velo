#!/usr/bin/env node
/**
 * Staged-content secret scanner (T1.15). Dependency-free so it runs in the
 * pre-commit hook on any machine, including CI without gitleaks.
 *
 * Exit 1 when a staged file or an ADDED line matches a secret pattern.
 * Usage:  node tools/secret-scan.js            # scan the index (pre-commit)
 *         node tools/secret-scan.js --all      # scan the whole tree (CI)
 */
const { execSync } = require('child_process');

const FORBIDDEN_FILES = [
  /(^|\/)\.env(\..+)?$/i, // .env, .env.local … (but not .env.example)
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /firebase-adminsdk.*\.json$/i,
  /(^|\/)secrets\//i,
];
const ALLOWED_FILES = [/\.env\.example$/i, /(^|\/)debug\.keystore$/i];

const PATTERNS = [
  { name: 'MongoDB connection string with password', re: /mongodb(\+srv)?:\/\/[^\s"'/@]+:[^\s"'@]+@/i },
  { name: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'Gradle signing password', re: /MYAPP_UPLOAD_(STORE|KEY)_PASSWORD\s*=\s*\S+/ },
  { name: 'JWT secret assignment', re: /JWT_SECRET\s*=\s*['"]?[A-Za-z0-9+/=_-]{16,}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Slack token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Firebase service account', re: /"type"\s*:\s*"service_account"/ },
  // Value must be a single token (no whitespace) and not a URL path.
  { name: 'Generic secret assignment', re: /(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"](?!\/)[^'"\s]{12,}['"]/i },
];

// Lines that legitimately contain a pattern (placeholders, docs, this file).
const ALLOWLIST = [
  /CHANGE_ME/, /<REDACTED>/, /<MASKED>/, /example\.com/, /\bplaceholder\b/i,
  /your[_-][a-z_]+/i, // README-style placeholders: your_jwt_secret_key
  /tools\/secret-scan\.js/, /secret-scan/, /^\s*(\/\/|#|\*)/, // comments
  /'x'\.repeat|'t'\.repeat|repeat\(/, // test fixtures
  /Generate one with/, /openssl rand/,
  /AKIAIOSFODNN7EXAMPLE|wJalrXUtnFEMI\/K7MDENG\/bPxRfiCYEXAMPLEKEY/, // the AWS documentation's example credentials (SigV4 known-answer test, T8.2)
];

// Files whose contents are public by design (documented in docs/AUDIT §0).
const ALLOWED_CONTENT_FILES = [
  /(^|\/)google-services\.json$/, // Android Firebase client config; key is app-restricted
];

const scanAll = process.argv.includes('--all');

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function stagedFiles() {
  return git('diff --cached --name-only --diff-filter=ACMR').split('\n').filter(Boolean);
}

function trackedFiles() {
  return git('ls-files').split('\n').filter(Boolean);
}

function addedLines(file) {
  const diff = scanAll ? git(`show :${file}`) : git(`diff --cached -U0 -- "${file}"`);
  if (scanAll) return diff.split('\n');
  return diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
}

const findings = [];
const files = scanAll ? trackedFiles() : stagedFiles();

for (const file of files) {
  if (ALLOWED_FILES.some((re) => re.test(file))) continue;
  if (FORBIDDEN_FILES.some((re) => re.test(file))) {
    findings.push({ file, line: 0, name: 'Forbidden file type' });
    continue;
  }
  if (/\.(png|jpe?g|gif|webp|ico|jar|apk|aab|ttf|otf|mp3|wav|lock)$/i.test(file) || file.endsWith('package-lock.json')) continue;
  if (ALLOWED_CONTENT_FILES.some((re) => re.test(file))) continue;

  let lines;
  try {
    lines = scanAll ? git(`show HEAD:${file}`).split('\n') : addedLines(file);
  } catch {
    continue; // binary or unreadable
  }
  lines.forEach((line, i) => {
    if (ALLOWLIST.some((re) => re.test(line))) return;
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) findings.push({ file, line: i + 1, name });
    }
  });
}

if (findings.length) {
  console.error('\n✖ secret-scan: refusing to commit. Possible secrets:\n');
  for (const f of findings) console.error(`  ${f.file}${f.line ? ':' + f.line : ''}  — ${f.name}`);
  console.error('\nIf this is a false positive, adjust the ALLOWLIST in tools/secret-scan.js.\n');
  process.exit(1);
}
console.log(`secret-scan: ${files.length} file(s) clean`);
