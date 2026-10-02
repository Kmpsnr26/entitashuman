# HumanALE Performance Stability Runner

This runner closes the remaining `performance-stability` evidence gap on a real Windows target.

## Procedure

1. Run the current packaged release-candidate HumanALE build. Portable
   `HumanALE-God-Engine.exe` and installed `HumanALE god egine.exe` are supported;
   development Electron processes cannot receive final acceptance.
2. Leave HumanALE idle.
3. From the repository root run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\humanale-performance-stability.ps1 `
  -ArtifactCommit $trustedBuildCommit `
  -ExpectedExecutableSha256 $trustedExecutableSha256 `
  -ExpectedRuntimeSha256 $trustedRuntimeSha256
```

4. Select the HumanALE process PID(s) shown by the runner.
5. Do not interact with HumanALE during the 60-second sampling window.
6. After sampling, answer the stability confirmation truthfully.

The runner records:

- validation checkout commit and branch, with candidate identity only when verified
- selected executable path/hash and full packaged runtime tree hash
- process executable path and start time, checked throughout sampling
- CPU average/peak
- RAM average/peak/delta
- process liveness
- Windows responding state
- operator stability confirmation
- bounded 5-second samples for 60 seconds

It does **not** invent CPU/RAM thresholds. Metrics are retained as evidence; PASS requires the selected processes to remain alive/responding and the operator to confirm no crash/error/repeated flicker during the window.

The trusted commit and both hashes must come from an independent reviewed build
record. `ExpectedExecutableSha256` alone cannot bind Electron app source:
`asar: false` stores the app beside the executable in `resources/app`.
`ExpectedRuntimeSha256` therefore binds that entire tree, including dependencies.
The digest is SHA-256 over UTF-8 records sorted with ordinal string comparison:
each record is `relative/path`, NUL, lowercase file SHA-256, LF. Paths use `/`.
The runtime must include `package.json`, `public/app.js`, and `desktop/main.cjs`.
Resources/app roots and all entries must be real files/directories; reparse
points are rejected. The executable and runtime hashes are checked before and
after sampling. This detects mutation between those checks; it is not continuous
filesystem attestation or proof that a forged expected build record is trusted.

All selected PIDs must use the same packaged executable path. A changed process
start time or path invalidates identity, including PID reuse. Hash/source
mismatches retain `candidate: "unknown"` and prevent PASS.

For bounded noninteractive diagnostics, provide explicit PIDs and use
`-ObserveOnly -DurationSeconds 30`. This records real measurements without an
operator prompt and always returns `PERFORMANCE_STABILITY_INCOMPLETE` (exit 2).
It cannot grant final acceptance. Durations are limited to 30..300 seconds,
intervals to 1..10 seconds, and selection to at most 32 positive PIDs. Reported
metrics apply only to selected processes, so select the whole application group.
Old output is removed before preflight to avoid reusing a previous PASS.

Output: `scripts/humanale-performance-stability-result.json`.

A PASS here only closes the HumanALE `performance-stability` gate. Android runtime, release-security, and creator approval remain separate gates.
