# Automated fix request for issue #80

Source issue: https://github.com/Kmpsnr26/entitashuman/issues/80

## Task

[CI] Verify and package gagal di codex/post-merge-final-security-20260926

Read the source issue for the latest evidence and acceptance criteria.

## Guardrails

- Start from `codex/post-merge-final-security-20260926`.
- Make the smallest safe fix and add regression coverage.
- Run `npm ci`, `npm run verify`, and relevant focused checks.
- Never commit secrets or weaken Electron/browser security boundaries.
- Do not create another issue, branch, or pull request.
- Keep this pull request in Draft until a human reviews the fix.
- Never merge automatically.

<!-- cloud-fallback-request: issue-80 -->