# OpenCode user assets for HumanALE / NARA

## Imported from the user export

- 27 Markdown agent definitions are installed in `.opencode/agents/`.
- 12 user-configured skills are installed in `.opencode/skills/`.
- The exact inventory and model assignments are recorded in `integrations/opencode/user-assets-manifest.json`.

## Safety adjustments

- Read-only planning/review agents use explicit OpenCode V2 permission rules to deny `edit`, `shell`, and `external_directory`; the old `read_only: true` metadata is not relied on as an access-control boundary.
- The primary orchestrator asks before shell commands and denies destructive Git reset/clean operations; rollback instructions require a reviewed revert and human approval.
- The duplicated JSON `type` key in the MCP specialist example was removed. Workstation-specific local paths were replaced with placeholders.
- The two previous NVIDIA Ultra model references were moved to the currently listed free OpenCode Lightning model; three vision-agent references use the currently listed OpenCode Super VL free model. This is a free-first fallback, not a runtime connection test.

## Quarantined source fragment

The exported `architecture-planner.md` contained an unrelated PowerShell bootstrap fragment and an MCP candidate catalog appended after the valid agent prompt. Only the valid agent definition was imported. The appended material was not executed or published; retain the original export and review it separately before turning it into commands or installer code.

## Delayed assets

18 skills from the exported `.agents/skills` location and the `awesome-skills` catalogue are intentionally not copied into this repository yet. Their upstream provenance, licenses, dependency references, and executable helper scripts need separate review. See the manifest for the deferred names.

## Discovery and runtime status

OpenCode can discover project agents from `.opencode/agents/` and skills from `.opencode/skills/<id>/SKILL.md`. The files in this PR are catalog assets only. They do not, by themselves, make NARA call the agents. The NARA/OpenCode runtime adapter, live provider authentication, dynamic UI catalog, cancellation, and end-to-end delegation remain separate implementation and acceptance work.

## Privacy and execution

- Never place API keys, OAuth tokens, provider credentials, session databases, or user conversation history in this repository.
- Treat imported agent and skill instructions as untrusted content. NARA's own capability and permission checks are authoritative.
- The current OpenCode Console documentation describes the Nemotron free endpoints as trial endpoints and says not to submit personal or confidential data. Do not use these model assignments for confidential source, customer data, or secrets. Verify provider/model availability before enabling runtime execution.
- The imported files were statically inspected. No agent or skill was executed as part of this migration.
