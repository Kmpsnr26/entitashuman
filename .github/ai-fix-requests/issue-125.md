# Automated fix request for issue #125

Source issue: https://github.com/Kmpsnr26/entitashuman/issues/125

## Task

[CI] NARA Neural Live Browser Smoke gagal di codex/nara-neural-space-3d-stage1

Read the source issue for the latest evidence and acceptance criteria.

## Guardrails

- Start from `codex/nara-neural-space-3d-stage1`.
- Make the smallest safe fix and add regression coverage.
- Run `npm ci`, `npm run verify`, and relevant focused checks.
- Never commit secrets or weaken Electron/browser security boundaries.
- Do not create another issue, branch, or pull request.
- Keep this pull request in Draft until a human reviews the fix.
- Never merge automatically.

<!-- cloud-fallback-request: issue-125 -->