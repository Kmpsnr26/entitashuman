# Automated fix request for issue #191

Source issue: https://github.com/Kmpsnr26/entitashuman/issues/191

## Task

[CI] Private source security gagal di codex/nara-network-window

Read the source issue for the latest evidence and acceptance criteria.

## Guardrails

- Start from `codex/nara-network-window`.
- Make the smallest safe fix and add regression coverage.
- Run `npm ci`, `npm run verify`, and relevant focused checks.
- Never commit secrets or weaken Electron/browser security boundaries.
- Do not create another issue, branch, or pull request.
- Keep this pull request in Draft until a human reviews the fix.
- Never merge automatically.

<!-- cloud-fallback-request: issue-191 -->