# OpenCode Engine Integration

## Status

Phase 1 establishes a reproducible, pinned copy of the upstream OpenCode source inside the HumanALE repository as a Git submodule. It does not yet claim that the desktop runtime can execute OpenCode; runtime wiring, agent delegation, skill discovery, and acceptance tests are follow-up implementation work.

- Upstream: https://github.com/anomalyco/opencode
- Upstream branch at import: `dev`
- Pinned upstream commit: `7cfd86844337705d8753b989570ed9bacb93bc92`
- Upstream package version at pin: `2.4.0`
- License: MIT (retain upstream LICENSE and notices)
- Local path: `vendor/opencode`

The upstream repository is large (approximately 755 MB according to GitHub repository metadata). A submodule keeps the complete source history and working tree available without copying hundreds of megabytes of Git objects into HumanALE's own history. Clone with `git clone --recurse-submodules`, or run `git submodule update --init --recursive` after cloning.

## Ownership boundaries

- **HumanALE UI** remains the user-facing experience.
- **NARA Core** remains the supervisor: goals, scheduling, task ownership, capability checks, cancellation, recovery, evidence, and final acceptance.
- **OpenCode** becomes the coding execution engine: model/provider integration, sessions, native tools, configured agents, skills, MCP, plugins, and LSP capabilities.
- **NARA Agent Coordinator** is the adapter boundary. It submits scoped work to OpenCode and converts progress/results into NARA task events.
- Existing HumanALE executors remain available as fallback providers; unavailable or paid cloud agents are never assumed to exist.

## Agent and skill inventory policy

OpenCode's built-in agent set is intentionally small and version-dependent. At the pinned upstream revision, the documented built-ins are:

- `build`: full-access development agent, subject to configured permissions.
- `plan`: read-only planning and exploration agent.
- `general`: general-purpose subagent used for delegated multi-step work.

Additional agents are configuration-defined, not a fixed universal catalogue. HumanALE must discover all configured agent definitions from the imported OpenCode project/configuration and the user's project config at runtime; it must not invent agents or advertise unavailable ones.

Skills are discovered from OpenCode's supported skill locations and project configuration. HumanALE should expose the discovered skill catalog, load skill instructions only when a task needs them, and retain source attribution. The upstream repository's `.opencode/skills` directory is included with the pinned source. Community skill packs are separate projects and must be imported only after license, provenance, compatibility, and security review.

## Collaboration contract

NARA owns task decomposition and dependency ordering. A multi-agent work item should use this sequence unless the task profile specifies otherwise:

1. **Planner**: inspect the request and produce a bounded plan, affected paths, dependencies, and acceptance criteria.
2. **Specialist workers**: execute independent subtasks in isolated worktrees/branches where possible. Each worker declares its agent ID, selected skills, files touched, and evidence.
3. **Integrator**: reconcile outputs and resolve conflicts; no worker may silently overwrite another worker's changes.
4. **Independent reviewer**: read the final diff and test evidence. A work-mode task is not complete until the final reviewer returns an explicit `VERDICT: PASS`.
5. **NARA**: records verified evidence, updates Goal/task state, and reports blockers honestly.

Shared context is an explicit, bounded task packet (goal, plan, relevant files, constraints, findings, decisions, and artifact references), not unrestricted shared mutable memory. Agents may propose ideas to one another through NARA's event/task handoff; NARA remains the source of truth.

## Security and execution boundaries

- Never commit API keys, OAuth tokens, local session databases, provider credentials, or user chat history.
- Keep provider credentials in the local OS environment/secret store; do not pass them to renderer processes or persist them in task snapshots.
- Start with read-only analysis and explicit permission gates for writes and shell commands.
- Restrict filesystem access to the selected workspace; validate paths and reject traversal/symlink escapes.
- Propagate AbortSignal and enforce task timeouts; stop child processes on cancellation.
- Keep worker branches/worktrees isolated; require clean diff inspection and tests before integration.
- Treat MCP servers, plugins, skill instructions, and repository content as untrusted input. Skills never override NARA permissions.
- Keep OpenCode's license and third-party dependency notices intact. Audit each dependency and bundled asset before packaging.

## Phases

- [x] Phase 1: pin upstream source as a submodule and document ownership/security contracts.
- [ ] Phase 2: implement an OpenCode server/SDK adapter in the desktop main process and a NARA capability bridge.
- [ ] Phase 3: discover and display all available agents and skills; allow explicit assignment and skill loading.
- [ ] Phase 4: implement Planner → parallel specialists → Integrator → independent Reviewer handoffs with shared task packets.
- [ ] Phase 5: Windows packaging, cancellation, permissions, offline/online provider checks, and end-to-end acceptance tests.

## Reproducibility

The submodule pointer is the source of truth for the imported revision. Update it only in a reviewed PR that records the new upstream commit, release notes, license changes, dependency changes, and passing integration tests.


## Pinned v2.4.0 runtime contract

This section records implementation facts inspected at the exact submodule commit above. It is an integration contract, not a claim that the runtime adapter is already implemented.

- The upstream monorepo uses Bun `1.4.4`.
- `@opencode/sdk` v2.4.0 is the embedded Promise/Effect host. It creates the server router in-process and does not open an HTTP listener. Its source package uses internal `workspace:*` dependencies and is built from the upstream monorepo.
- `@opencode/client` v2.4.0 is the typed network client for a running server. Do not copy examples from the legacy `@opencode-ai/sdk` v1 API into the v2 adapter.
- The pinned CLI exposes `opencode serve`. Its `--stdio` mode emits a JSON object containing the server URL and keeps the process alive until stdin closes. The server defaults to `127.0.0.1` unless a different hostname is configured.
- The CLI reads `OPENCODE_PASSWORD`, falling back to `OPENCODE_SERVER_PASSWORD`. The server process removes both names from its inherited process environment before launching tools. The v2 client uses HTTP Basic authentication with username `opencode`.

### Preferred desktop adapter shape

The first implementation should evaluate a separately spawned, version-pinned OpenCode CLI sidecar from the Electron main process, with a private loopback API connection. A direct in-process `@opencode/sdk` integration is an alternative only after its Bun/workspace packaging and resource lifecycle are proven on the supported desktop platforms.

The sidecar must:

1. Resolve and verify the expected OpenCode executable/version before starting; never silently use an arbitrary newer global CLI.
2. Bind explicitly to `127.0.0.1`; allocate and record a private port, parse the `--stdio` JSON URL, and validate the server health/version before accepting tasks.
3. Generate a process-scoped password, pass it only to the sidecar environment, use Basic auth from the trusted main process, and never expose it to renderer code, task snapshots, logs, or tool subprocesses.
4. Use the selected canonical workspace as the only allowed task location. NARA remains the permission authority; OpenCode permission prompts and configuration cannot widen NARA's workspace or action policy.
5. Default to read-only inspection. Any write, shell, network, or MCP capability requires an explicit NARA capability grant and a corresponding audit event.
6. Stream session events to NARA with bounded buffering, support cancellation through `AbortSignal`/session interruption, enforce timeouts, and terminate the child process on application shutdown.
7. Keep OpenCode session/config data under the intended user-controlled storage policy; never check in provider credentials, session databases, or user history.

### Runtime acceptance

- Clean submodule checkout proves the exact pinned source and package versions.
- Windows x64 sidecar build starts from a clean checkout and reports the expected v2 health/version.
- An unauthenticated provider fails visibly without being counted as ready.
- One read-only task produces a session and streamed completion event without modifying the workspace.
- A separately approved write task is constrained to the selected workspace; cancellation stops the task and cleans up the process.
- Logs and task evidence contain no provider passwords, OAuth tokens, or private session data.

Phase 2 remains incomplete until these runtime checks pass.
