#!/usr/bin/env node
/**
 * AleCore AI identity migration audit.
 *
 * Usage:
 *   node scripts/alecore-rename-audit.mjs
 *   node scripts/alecore-rename-audit.mjs --strict
 *
 * Report mode is intentionally non-blocking while the migration is in progress.
 * Strict mode exits non-zero while legacy NARA identifiers remain.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'coverage', '.turbo']);
const LEGACY_PATH = /nara/i;
const LEGACY = /nara/ig;
const findings = [];

async function walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) {
    findings.push({ file: path.relative(ROOT, dir), line: 0, error: error.message });
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const relative = path.relative(ROOT, full);
    if (LEGACY_PATH.test(relative)) findings.push({ file: relative, line: 0, kind: 'filename' });
    let buffer;
    try { buffer = await readFile(full); } catch { continue; }
    if (buffer.includes(0)) continue;
    const content = buffer.toString('utf8');
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      LEGACY.lastIndex = 0;
      if (LEGACY.test(lines[index])) {
        findings.push({ file: relative, line: index + 1, kind: 'content' });
      }
    }
  }
}

await walk(ROOT);
const unique = new Map();
for (const item of findings) {
  const key = item.file + ':' + item.line + ':' + (item.kind || 'error');
  unique.set(key, item);
}
const rows = [...unique.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const fileCount = new Set(rows.map(row => row.file)).size;
console.log('AleCore AI legacy identity audit');
console.log('Mode:', STRICT ? 'strict' : 'report');
console.log('Files with findings:', fileCount);
console.log('Findings:', rows.length);
for (const row of rows) {
  console.log(row.file + (row.line ? ':' + row.line : '') + ' [' + (row.kind || 'read-error') + ']');
}
if (rows.length) {
  console.log('Legacy NARA identifiers remain. Continue the staged migration before enabling strict CI.');
}
if (STRICT && rows.length) process.exitCode = 1;
