# Copilot instructions for HumanALE

When assigned an issue in this repository:

- Work only on the assigned issue and use its requested base branch.
- Keep one branch and one Draft PR for the task. Do not create recursive issues, branches, or pull requests.
- Never merge, enable auto-merge, publish a release, or weaken branch protection.
- Never commit credentials, tokens, API keys, production data, or local environment files.
- Do not edit \`.github/workflows/**\` unless the assigned issue explicitly identifies a workflow defect.
- Preserve Electron boundaries: \`nodeIntegration: false\`, \`contextIsolation: true\`, \`sandbox: true\`, trusted-origin IPC checks, and no arbitrary renderer shell access.
- Prefer the smallest root-cause fix with regression coverage.
- Run \`npm ci\`, \`npm run verify\`, and relevant focused checks. Run \`npm run smoke:terminal\` for desktop terminal changes.
- Treat successful tests as evidence only for what they cover. Do not claim that packaging, native UI, credentials, or live cloud providers work unless those paths were actually verified.
- Summarize changed files, root cause, tests run, residual risk, and any manual verification required in the Draft PR.
