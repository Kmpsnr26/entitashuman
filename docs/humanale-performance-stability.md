# HumanALE Performance Stability Runner

This runner closes the remaining `performance-stability` evidence gap on a real Windows target.

## Procedure

1. Run the current release-candidate HumanALE build.
2. Leave HumanALE idle.
3. From the repository root run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\humanale-performance-stability.ps1
```

4. Select the HumanALE process PID(s) shown by the runner.
5. Do not interact with HumanALE during the 60-second sampling window.
6. After sampling, answer the stability confirmation truthfully.

The runner records:

- active Git commit and branch
- CPU average/peak
- RAM average/peak/delta
- process liveness
- Windows responding state
- operator stability confirmation
- bounded 5-second samples for 60 seconds

It does **not** invent CPU/RAM thresholds. Metrics are retained as evidence; PASS requires the selected processes to remain alive/responding and the operator to confirm no crash/error/repeated flicker during the window.

Output: `scripts/humanale-performance-stability-result.json`.

A PASS here only closes the HumanALE `performance-stability` gate. Android runtime, release-security, and creator approval remain separate gates.
