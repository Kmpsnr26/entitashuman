# OpenCode user agents and skills migration

## Scope

This migration imports user-provided custom agent and skill definitions into project-local OpenCode discovery paths. It is an asset/catalog phase, not proof of runtime execution.

| Asset | Imported | Destination |
|---|---:|---|
| Custom agents | 27 | `.opencode/agents/` |
| User-configured skills | 12 | `.opencode/skills/<id>/SKILL.md` |
| Additional third-party/community skills | 18 deferred | Not copied |
| `awesome-skills` catalogue | Deferred | Not copied |

The complete list is maintained in `integrations/opencode/user-assets-manifest.json`.

## Agent model assignments

All imported agents now reference one of two free-tier OpenCode Console model IDs: `opencode/nemotron-3.5-lightning-free` and `opencode/nemotron-3.5-super-vl-free`. The Super VL model is reserved for vision-oriented agents. Two prior Ultra references were replaced with the Lightning model because a current free Ultra Console model was not verified in the official Console free-model list. Three vision agents use the Super VL free model. This preserves a free-first default while reducing the advanced planner model tier. These free models can be temporary and are not guaranteed to remain available.

OpenCode's current Console documentation lists both models as free, but identifies the Nemotron free endpoints as NVIDIA trial endpoints and says not to submit personal or confidential data. Runtime must therefore require explicit provider readiness and must not route confidential code or secrets to these trial models.

## Permission hardening

OpenCode's V2 agent format supports explicit ordered permission rules in Markdown frontmatter. Six planning/review agents (`architecture-planner`, `architecture-planner-advanced`, `software-architect`, `software-architect-advanced`, `code-reviewer`, and `security-auditor`) deny `edit`, `shell`, and `external_directory`. The orchestrator prompts before shell use and denies `git reset` and `git clean`. These rules reduce risk inside OpenCode; HumanALE/NARA must still enforce its own permission checks outside the model.

## Source quarantine and privacy cleanup

The exported `architecture-planner.md` contains unrelated PowerShell `New-Agent`/`New-Command` and MCP-catalog content appended after its valid agent prompt. The migration imports only the valid agent portion; the appended fragment is not executed or published pending a separate source review. The MCP specialist examples also contained workstation-specific paths, which are replaced with placeholders in this public repository.

## Compatibility

OpenCode project discovery paths used here are `.opencode/agents/<name>.md` and `.opencode/skills/<name>/SKILL.md`. Skill instructions are loaded on demand. Duplicate skill IDs should be avoided because project-local definitions may override earlier sources.

## Validation

Materialize the verified bundle from the repository root with `node scripts/opencode/materialize-user-assets.mjs`. The installer validates the bundle and per-file checksums, rejects unsafe paths, and refuses to overwrite differing existing files unless `--force` is explicitly supplied. Then run the static test with:

```sh
node --test tests/opencode-user-assets.test.mjs
```

The test checks counts, unique IDs, model allowlists, expected paths, and explicit read-only permission rules. It does not contact model providers or execute imported scripts.

## Follow-up phases

1. Implement the OpenCode server/SDK adapter in the Electron main process.
2. Have NARA discover the agent and skill manifest at runtime, while retaining OpenCode as the source of truth for agent files.
3. Implement task dispatch, cancellation, isolated workspaces, bounded task packets, result/evidence capture, and independent review.
4. Test a local runtime with a non-confidential sample workspace and a provider that the user has explicitly enabled.
5. Audit and add deferred skills one upstream source/license family at a time.
