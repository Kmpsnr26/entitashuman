const SUPPORTED_EXECUTORS = new Set(["codex", "github-copilot", "cursor", "claude"]);

const fail = (error) => ({ ok: false, error });

export function validateConversationTeamDiagnostic(result) {
  if (!Array.isArray(result?.executors)) {
    return fail("Pipeline tidak melaporkan daftar executor aktual dari orchestrator.");
  }

  const executors = [...new Set(result.executors)];
  if (
    executors.length !== result.executors.length ||
    executors.length < 2 ||
    executors.some((id) => !SUPPORTED_EXECUTORS.has(id))
  ) {
    return fail("Daftar executor aktual tidak valid atau kurang dari dua executor lokal.");
  }

  const stages = Array.isArray(result?.stages) ? result.stages : [];
  const expectedSpecialists = Math.max(0, executors.length - 3);
  const expectedRoles = [
    "planner",
    ...Array(expectedSpecialists).fill("specialist"),
    "worker",
    "reviewer",
  ];

  if (
    stages.length !== expectedRoles.length ||
    stages.some((stage, index) => stage?.role !== expectedRoles[index])
  ) {
    return fail("Tahap kolaborasi tidak lengkap atau urutannya tidak sesuai kontrak Planner → Specialist → Worker → Reviewer.");
  }

  for (const stage of stages) {
    if (
      typeof stage.agent !== "string" ||
      !SUPPORTED_EXECUTORS.has(stage.agent) ||
      !executors.includes(stage.agent) ||
      typeof stage.text !== "string" ||
      !stage.text.trim()
    ) {
      return fail("Setiap tahap harus melaporkan executor aktual yang dikenal dan hasil teks yang tidak kosong.");
    }
  }

  const planner = stages[0];
  const specialists = stages.filter((stage) => stage.role === "specialist");
  const worker = stages.find((stage) => stage.role === "worker");
  const reviewer = stages.find((stage) => stage.role === "reviewer");

  if (planner.agent === worker.agent) {
    return fail("Planner dan Worker harus dijalankan oleh executor yang berbeda.");
  }
  if (worker.agent === reviewer.agent) {
    return fail("Reviewer memakai executor yang sama dengan Worker; review independen tidak terbukti.");
  }

  const assignedExecutors = new Set(stages.map((stage) => stage.agent));
  if (assignedExecutors.size !== executors.length) {
    return fail("Identitas executor pada tahapan tidak mencakup seluruh executor yang dilaporkan orchestrator.");
  }

  const verdict = String(reviewer.text || "").toUpperCase();
  if (/\bVERDICT\s*:\s*NEEDS_FIX\b/.test(verdict)) {
    return fail("Reviewer memberi VERDICT: NEEDS_FIX.");
  }
  if (!/\bVERDICT\s*:\s*PASS\b/.test(verdict)) {
    return fail("Reviewer belum memberikan VERDICT: PASS.");
  }

  return { ok: true, executors, planner, specialists, worker, reviewer };
}
