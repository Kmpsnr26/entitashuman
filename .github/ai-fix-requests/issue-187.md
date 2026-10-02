# Automated fix request for issue #187

Source issue: https://github.com/Kmpsnr26/entitashuman/issues/187

## Task

[CI] Private source security gagal di codex/cloud-auto-repair-permission-guard

Read the source issue for the latest evidence and acceptance criteria.

## Guardrails

- Start from `codex/cloud-auto-repair-permission-guard`.
- Make the smallest safe fix and add regression coverage.
- Run `npm ci`, `npm run verify`, and relevant focused checks.
- Never commit secrets or weaken Electron/browser security boundaries.
- Do not create another issue, branch, or pull request.
- Keep this pull request in Draft until a human reviews the fix.
- Never merge automatically.

<!-- cloud-fallback-request: issue-187 -->