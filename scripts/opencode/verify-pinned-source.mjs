import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const expected = "7cfd86844337705d8753b989570ed9bacb93bc92";
const upstream = join(root, "vendor", "opencode");

function git(args, cwd = root) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const configuredUrl = git([
  "config",
  "-f",
  ".gitmodules",
  "--get",
  "submodule.vendor/opencode.url",
]).trim();
assert.equal(
  configuredUrl,
  "https://github.com/anomalyco/opencode.git",
  "OpenCode must come from the official upstream repository",
);

const treeEntry = git(["ls-tree", "HEAD", "vendor/opencode"]).trim();
const treeMatch = treeEntry.match(/^160000 commit ([a-f0-9]{40})\s+vendor\/opencode$/);
assert.ok(treeMatch, "vendor/opencode must be a Git submodule gitlink");
assert.equal(treeMatch[1], expected, "Gitlink must match the documented upstream pin");

const checkedOutSha = git(["rev-parse", "HEAD"], upstream).trim();
assert.equal(checkedOutSha, expected, "Initialized OpenCode submodule must match the pinned commit");

const statusLines = git(["submodule", "status", "--recursive", "vendor/opencode"])
  .trimEnd()
  .split(/\r?\n/);
const rootStatus = statusLines.find((line) => line.endsWith(" vendor/opencode"));
assert.ok(rootStatus, "Git must report the OpenCode submodule");
assert.equal(rootStatus[0], " ", "OpenCode submodule must be initialized at the recorded commit");

const rootPackage = readJson(join(upstream, "package.json"));
assert.equal(rootPackage.name, "opencode");
assert.equal(rootPackage.version, "2.4.0");
assert.equal(rootPackage.packageManager, "bun@1.4.4");

const sdk = readJson(join(upstream, "packages", "sdk", "package.json"));
assert.equal(sdk.name, "@opencode/sdk");
assert.equal(sdk.version, "2.4.0");
assert.equal(sdk.dependencies["@opencode/client"], "workspace:*");

const client = readJson(join(upstream, "packages", "client", "package.json"));
assert.equal(client.name, "@opencode/client");
assert.equal(client.version, "2.4.0");

const cli = readJson(join(upstream, "packages", "cli", "package.json"));
assert.equal(cli.version, "2.4.0");
assert.equal(cli.bin.opencode, "./bin/opencode.cjs");

const integrationDocs = readFileSync(join(root, "docs", "opencode-integration.md"), "utf8");
assert.ok(integrationDocs.includes(expected), "Integration documentation must record the exact upstream pin");

console.log("OpenCode pinned source verification: PASS");
console.log("upstream=anomalyco/opencode");
console.log("commit=" + checkedOutSha);
console.log("version=" + rootPackage.version);
console.log("sdk=@opencode/sdk@" + sdk.version);
console.log("client=@opencode/client@" + client.version);
console.log("toolchain=" + rootPackage.packageManager);
