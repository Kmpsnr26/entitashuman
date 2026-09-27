// Test mirror of the privileged inline workflow helpers. The regression suite
// asserts source parity so behavior tests cannot drift from GitHub Actions.
export function fallbackBranchFor(issueNumber) {
  return 'automation/issue-' + issueNumber;
}

export function fallbackMarkerFor(issueNumber) {
  return '<!-- cloud-fallback-request: issue-' + issueNumber + ' -->';
}

export function isFallbackPullRequest(pull, issueNumber) {
  const body = pull.body || '';
  const head = pull.head && pull.head.ref ? pull.head.ref : '';
  const legacyMarker = 'Tracks #' + issueNumber + '.';
  const hasLegacyMarker = body
    .split(/\r?\n/)
    .some((line) => line.trim() === legacyMarker);
  return Boolean(
    pull.draft &&
    head === fallbackBranchFor(issueNumber) &&
    (body.includes(fallbackMarkerFor(issueNumber)) || hasLegacyMarker)
  );
}

export function issueRecovered(issue) {
  const labels = (issue.labels || []).map((label) =>
    typeof label === 'string' ? label : label.name
  );
  return issue.state !== 'open' || labels.includes('automation:resolved');
}

export function selectLatestFailedRuns(runs, options) {
  const {
    cutoff,
    defaultBranch,
    failureConclusions,
    limit = 3
  } = options;
  const latestByWorkflowAndBranch = new Map();

  for (const run of runs) {
    const branch = run.head_branch || defaultBranch;
    const updatedAt = Date.parse(run.updated_at);
    if (!branch || branch.startsWith('automation/')) continue;
    if (run.name === 'Cloud Auto Repair') continue;
    if (!Number.isFinite(updatedAt)) continue;

    const key = run.workflow_id + ':' + branch;
    const current = latestByWorkflowAndBranch.get(key);
    if (!current) {
      latestByWorkflowAndBranch.set(key, run);
      continue;
    }

    const currentUpdatedAt = Date.parse(current.updated_at);
    const currentId = Number(current.id) || 0;
    const runId = Number(run.id) || 0;
    if (
      updatedAt > currentUpdatedAt ||
      (updatedAt === currentUpdatedAt && runId > currentId)
    ) {
      latestByWorkflowAndBranch.set(key, run);
    }
  }

  return [...latestByWorkflowAndBranch.values()]
    .filter((run) =>
      failureConclusions.has(run.conclusion) &&
      Date.parse(run.updated_at) >= cutoff
    )
    .sort((left, right) => {
      const timeDifference = Date.parse(right.updated_at) - Date.parse(left.updated_at);
      if (timeDifference !== 0) return timeDifference;
      return (Number(right.id) || 0) - (Number(left.id) || 0);
    })
    .slice(0, limit);
}
