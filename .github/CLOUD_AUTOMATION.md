# GitHub Cloud Auto-Repair

This repository keeps the automation state in GitHub Issues, labels, branches, pull requests, and Actions. A local computer is not part of the execution path.

Control issue: [#52](https://github.com/Kmpsnr26/entitashuman/issues/52)

## Cloud ownership

- Repository owner: `Kmpsnr26`.
- Repository visibility: public, so standard GitHub-hosted runners run in GitHub's cloud without depending on the local PC.
- Actions are allowed, the repository `GITHUB_TOKEN` has read/write access, and Actions may create Draft pull requests.
- Ownership and Actions permissions were verified after the repository transfer on 2026-09-26.
- Automatic merge remains disabled; generated changes must stay reviewable.

## Event flow

1. **Pull requests** are inspected only when explicitly labeled `bug`, `type:bug`, `ci-failure`, or `ai-fix-needed`, or when their title begins with `[bug]`, `[error]`, `[failure]`, or `[gagal]`.
2. **Issues** are queued when their title clearly indicates a bug/error/failure or they have an actionable label. The control issue is excluded.
3. **Workflow runs** from `Verify and package` and `Build Android APK` are handled immediately when completed. Future or renamed workflows are still found by the scheduled scan.
4. **Scheduled scans** run every three hours, inspect the last 24 hours, and process at most three distinct failures per run.
5. **Manual dispatch** scans the last seven days and is useful after enabling the workflow or recovering a GitHub outage.

A CI fingerprint is `workflow:<workflow-id>:<branch>`. The automation stores it in a hidden marker in the managed issue, so repeated failures update and reopen the same issue. A later successful run closes that issue.

## Copilot assignment

GitHub's issue assignment API requires a user token or a GitHub App user-to-server token. The normal Actions `GITHUB_TOKEN` is intentionally not treated as sufficient.

To enable direct delegation:

1. Enable GitHub Copilot cloud agent for this repository.
2. Create a fine-grained user token with repository access and these permissions: metadata read; Actions, Contents, Issues, and Pull requests read/write.
3. Store it in the repository Actions secret named `COPILOT_ASSIGN_TOKEN`.
4. Never put the token in a file, issue, PR, log, workflow input, or source-controlled environment file.
5. Run **Cloud Auto Repair** manually once to process recent failures.

When the token is present, the workflow calls the official REST assignment endpoint with `copilot-swe-agent[bot]`, the target repository, the relevant base branch, and bounded instructions. GitHub Copilot then owns creation of its Draft PR.

## Safe fallback

If the secret is absent, assignment fails, or Copilot is unavailable:

- the issue remains labeled `ai-fix-needed` and `automation:fallback`;
- the workflow creates or updates `automation/issue-<number>`;
- it writes one request file under `.github/ai-fix-requests/`;
- it creates at most one open Draft PR for that branch;
- the Draft PR is a durable work queue, not a claim that the bug is fixed.

GitHub suppresses new workflow runs caused by the repository `GITHUB_TOKEN`. The workflow also ignores `automation/*` branches and Copilot-authored pull requests. These controls prevent recursive PR creation.

## Required repository settings

The GitHub connector used to prepare this change cannot modify administrative settings. Configure these settings in **Settings → Branches / Rulesets** and **Settings → Actions → General**:

### Protect `main`

- Require a pull request before merging.
- Require at least one approval.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution.
- Require the status check `Verify and package / windows`.
- Require branches to be up to date before merging.
- Block force pushes and branch deletion.
- Do not allow bypass for the automation.
- Do not enable auto-merge for `automation/*` or Copilot-generated PRs.

`Build Android APK` currently runs on pushes to `main`, not on pull requests, so it should not be a required PR check unless its triggers are changed.

### Allow the fallback PR

Enable **Allow GitHub Actions to create and approve pull requests** only if the deterministic Draft PR fallback is desired. The workflow never approves or merges a PR; it only needs permission to create one.

Keep the default requirement for human approval before running workflows proposed by a Copilot-authored PR, especially when `.github/workflows/**` changes.

## Permissions and limits

The workflow begins with `permissions: {}` and grants only per-job scopes:

- triage: Actions read, Contents read, Issues write, Pull requests read;
- fallback: Contents write, Issues write, Pull requests write.

It uses one concurrency group per source event, `cancel-in-progress: false`, a ten-minute job timeout, no retry loop, a maximum of three scheduled failures, deterministic issue fingerprints, deterministic branches, and one open Draft PR per issue.

No repository secret is required for the fallback path. No secret value is stored in the repository.

## Operations

- Trigger a rescan from **Actions → Cloud Auto Repair → Run workflow**.
- Add `ai-fix-needed` to an existing issue to queue it.
- Add `ai-fix-needed` to a PR only when a separate repair task is desired.
- Remove the label and close the managed issue to stop work. If the same CI fingerprint fails again, the issue will reopen.
- Review every generated Draft PR; this automation never merges.
