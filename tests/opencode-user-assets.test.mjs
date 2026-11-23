import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = path.join(root, ".opencode", "agents");
const skillDir = path.join(root, ".opencode", "skills");
const manifestPath = path.join(root, "integrations", "opencode", "user-assets-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true });
const agentFiles = files(agentDir).filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
const skillFiles = files(skillDir).filter((entry) => entry.isDirectory()).map((entry) => path.join(skillDir, entry.name, "SKILL.md"));
const readAgent = (id) => fs.readFileSync(path.join(agentDir, `${id}.md`), "utf8");

test("imports exactly 27 unique agents and 12 unique skills", () => {
  assert.equal(agentFiles.length, 27);
  assert.equal(manifest.agents.length, 27);
  assert.equal(new Set(manifest.agents.map((item) => item.id)).size, 27);
  assert.equal(skillFiles.length, 12);
  assert.equal(manifest.skills.length, 12);
  assert.equal(new Set(manifest.skills.map((item) => item.id)).size, 12);
  for (const file of skillFiles) assert.ok(fs.statSync(file).size > 0, `${file} must not be empty`);
});

test("all agent models use the approved free-first allowlist", () => {
  const allowed = new Set([
    "opencode/nemotron-3.5-lightning-free",
    "opencode/nemotron-3.5-super-vl-free",
  ]);
  for (const entry of manifest.agents) assert.ok(allowed.has(entry.model), `${entry.id} has unexpected model ${entry.model}`);
  for (const file of agentFiles) {
    const content = fs.readFileSync(path.join(agentDir, file.name), "utf8");
    assert.doesNotMatch(content, /^model:\s*nvidia\/nvidia\//m);
  }
});

test("planning and independent review agents have explicit write-deny rules", () => {
  for (const id of ["architecture-planner", "architecture-planner-advanced", "software-architect", "software-architect-advanced", "code-reviewer", "security-auditor"]) {
    const content = readAgent(id);
    assert.match(content, /action: edit[\s\S]*?effect: deny/);
    assert.match(content, /action: shell[\s\S]*?effect: deny/);
    assert.match(content, /action: external_directory[\s\S]*?effect: deny/);
    assert.doesNotMatch(content, /^read_only:\s*true/m);
  }
});

test("MCP specialist example has no duplicate JSON type property", () => {
  const content = readAgent("mcp-specialist");
  const match = content.match(/### Local Binary[^`]*```json\s*([\s\S]*?)```/);
  assert.ok(match, "local binary JSON example must exist");
  const config = JSON.parse(match[1]);
  assert.equal(config.type, "local");
  assert.match(config.command[0], /YOUR_MCP_INSTALL_DIR.*github-mcp-launcher\.cmd/);
});

test("quarantines appended bootstrap text and removes workstation-specific paths", () => {
  const planner = readAgent("architecture-planner");
  const mcp = readAgent("mcp-specialist");
  assert.doesNotMatch(planner, /New-Agent|New-Command|\$mcpCatalog/);
  assert.doesNotMatch(mcp, /C:\\Users\\ekaso|C:\\AleStudioMCP/);
  assert.match(mcp, /%USERPROFILE%/);
});

test("orchestrator requires approval for shell and blocks destructive Git recovery", () => {
  const content = readAgent("orchestrator");
  assert.match(content, /action: shell[\s\S]*?effect: ask/);
  assert.match(content, /resource: "\*git reset\*"[\s\S]*?effect: deny/);
  assert.match(content, /resource: "\*git clean\*"[\s\S]*?effect: deny/);
  assert.match(content, /Never run `git reset --hard`/);
});

test("manifest explicitly records deferred community skills and runtime boundary", () => {
  assert.equal(manifest.deferredThirdPartySkills.length, 18);
  assert.deepEqual(manifest.deferredCatalogues, ["awesome-skills"]);
  assert.equal(manifest.runtimeStatus, "assets-imported-runtime-adapter-pending");
});


test("installer refuses symlinked parent directories outside the destination", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "humanale-opencode-assets-"));
  const destination = path.join(base, "destination");
  const outside = path.join(base, "outside");
  const agents = path.join(destination, ".opencode", "agents");
  fs.mkdirSync(path.join(destination, ".opencode"), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  try {
    fs.symlinkSync(outside, agents, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    fs.rmSync(base, { recursive: true, force: true });
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip("Directory symlinks are unavailable in this environment.");
      return;
    }
    throw error;
  }

  try {
    const installer = path.join(root, "scripts", "opencode", "materialize-user-assets.mjs");
    const result = spawnSync(process.execPath, [installer, "--destination", destination], { encoding: "utf8" });
    assert.notEqual(result.status, 0, "installer must reject a symlinked parent directory");
    assert.match(result.stderr, /unsafe parent directory/i);
    assert.deepEqual(fs.readdirSync(outside), [], "installer must not write outside the selected destination");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("installer uses exclusive creation for temporary files", async () => {
  const installer = await fs.promises.readFile(path.join(root, "scripts", "opencode", "materialize-user-assets.mjs"), "utf8");
  assert.match(installer, /openSync\(temporary, "wx"/);
  assert.match(installer, /randomBytes\(8\)/);
});


test("system and package-management agents require approval for shell and file changes", () => {
  for (const id of ["windows-operator", "plugin-manager", "skill-engineer"]) {
    const content = readAgent(id);
    assert.match(content, /action: shell[\s\S]*?effect: ask/);
    assert.match(content, /action: edit[\s\S]*?effect: ask/);
    assert.match(content, /action: external_directory[\s\S]*?effect: ask/);
  }
});

test("skill engineer labels exported catalog as unverified rather than active", () => {
  const content = readAgent("skill-engineer");
  assert.match(content, /Source Export Skill Inventory \(Unverified\)/);
  assert.match(content, /only the 12 project-local skills/);
  assert.match(content, /18 community skills/);
  assert.doesNotMatch(content, /✅ Active/);
});
