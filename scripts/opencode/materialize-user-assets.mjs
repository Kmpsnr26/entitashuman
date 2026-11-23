#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "../..");
const bundlePath = path.join(repositoryRoot, "integrations/opencode/user-assets-v1.bundle.json.gz");
const expectedBundleSha256 = "09bca50479f0e0aa6615b027ae67e2fea9cf6d6a2db14de8c1c6506cbef3adc1";
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const force = args.includes("--force");
let destinationRoot = repositoryRoot;

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--destination") {
    const candidate = args[index + 1];
    if (!candidate) throw new Error("--destination requires a directory path.");
    destinationRoot = path.resolve(candidate);
    index += 1;
  } else if (!["--check", "--force"].includes(args[index])) {
    throw new Error(`Unknown argument: ${args[index]}`);
  }
}

const allowedPath = (relativePath) =>
  relativePath.startsWith(".opencode/agents/") ||
  relativePath.startsWith(".opencode/skills/") ||
  relativePath === "docs/opencode-user-assets-migration.md" ||
  relativePath === "integrations/opencode/README.md" ||
  relativePath === "integrations/opencode/user-assets-manifest.json" ||
  relativePath === "tests/opencode-user-assets.test.mjs";

function resolveSafeTarget(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\") || path.posix.isAbsolute(relativePath)) {
    throw new Error(`Unsafe bundle path: ${String(relativePath)}`);
  }
  const normalized = path.posix.normalize(relativePath);
  if (normalized !== relativePath || normalized.split("/").includes("..") || !allowedPath(normalized)) {
    throw new Error(`Bundle path is outside the approved asset allowlist: ${relativePath}`);
  }
  const target = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Bundle path escapes destination: ${relativePath}`);
  }
  return target;
}

function assertSafeParentDirectories(root, relativePath, { create = false } = {}) {
  let current = root;
  for (const segment of relativePath.split("/").slice(0, -1)) {
    current = path.join(current, segment);
    let info;
    try {
      info = fs.lstatSync(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (!create) return;
      fs.mkdirSync(current);
      info = fs.lstatSync(current);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Refusing unsafe parent directory: ${current}`);
    }
  }
}

function readBundle() {
  const compressed = fs.readFileSync(bundlePath);
  const actualHash = crypto.createHash("sha256").update(compressed).digest("hex");
  if (actualHash !== expectedBundleSha256) throw new Error("Bundle SHA-256 mismatch; refusing to extract.");
  const document = JSON.parse(gunzipSync(compressed).toString("utf8"));
  if (document.version !== 1 || !Array.isArray(document.files) || document.files.length !== 43) {
    throw new Error("Unsupported bundle format or unexpected file count.");
  }
  const seen = new Set();
  for (const file of document.files) {
    const target = resolveSafeTarget(destinationRoot, file.path);
    if (seen.has(file.path)) throw new Error(`Duplicate bundle path: ${file.path}`);
    seen.add(file.path);
    if (typeof file.content !== "string") throw new Error(`Missing text content: ${file.path}`);
    const actualFileHash = crypto.createHash("sha256").update(file.content, "utf8").digest("hex");
    if (actualFileHash !== file.sha256) throw new Error(`File checksum mismatch: ${file.path}`);
    file.target = target;
  }
  return { compressedHash: actualHash, files: document.files };
}

const bundle = readBundle();
if (checkOnly) {
  console.log(`Bundle OK: ${bundle.files.length} files; SHA-256 ${bundle.compressedHash}`);
  process.exit(0);
}

const conflicts = [];
for (const file of bundle.files) {
  assertSafeParentDirectories(destinationRoot, file.path);
  if (!fs.existsSync(file.target)) continue;
  const stat = fs.lstatSync(file.target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Refusing to replace non-regular file: ${file.path}`);
  const currentHash = crypto.createHash("sha256").update(fs.readFileSync(file.target)).digest("hex");
  if (currentHash !== file.sha256) conflicts.push(file.path);
}
if (conflicts.length && !force) {
  throw new Error(`Existing files differ; nothing was written. Back up and inspect, or re-run with --force: ${conflicts.join(", ")}`);
}

fs.mkdirSync(destinationRoot, { recursive: true });
destinationRoot = fs.realpathSync(destinationRoot);
for (const file of bundle.files) {
  assertSafeParentDirectories(destinationRoot, file.path, { create: true });
  file.target = resolveSafeTarget(destinationRoot, file.path);
  try {
    const targetInfo = fs.lstatSync(file.target);
    if (targetInfo.isSymbolicLink() || !targetInfo.isFile()) {
      throw new Error(`Refusing to replace non-regular file: ${file.path}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const temporary = `${file.target}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, file.content, { encoding: "utf8" });
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, file.target);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}
console.log(`Materialized ${bundle.files.length} verified files into ${destinationRoot}`);
