export const AI_MAINTENANCE_AUTOPILOT_VERSION='1.1.0';
export const AI_MAINTENANCE_AUTOPILOT_MAX_ATTEMPTS=2;
export const AI_MAINTENANCE_AUTOPILOT_VERIFY_TIMEOUT_MS=15*60*1000;

const NON_RETRYABLE_CODES=new Set([
 'AI_MAINTENANCE_BOUNDARY_BLOCKED',
 'AI_MAINTENANCE_CHANGESET_BLOCKED',
 'AI_MAINTENANCE_MANUAL_RECOVERY_REQUIRED',
 'AI_MAINTENANCE_REPO_LOCKED',
 'AI_MAINTENANCE_PROTECTED_BRANCH',
 'AI_MAINTENANCE_SECRET_FILE_PRESENT',
 'AI_MAINTENANCE_DIRTY_WORKTREE',
 'AI_MAINTENANCE_ROOT_MISMATCH',
 'AI_MAINTENANCE_DETACHED_HEAD',
 'AI_MAINTENANCE_ROLLBACK_INCOMPLETE'
]);

export function normalizeAutopilotAttempts(value){
 const parsed=Number(value);
 if(!Number.isFinite(parsed))return AI_MAINTENANCE_AUTOPILOT_MAX_ATTEMPTS;
 return Math.max(1,Math.min(
  AI_MAINTENANCE_AUTOPILOT_MAX_ATTEMPTS,
  Math.round(parsed)
 ));
}

export function isNonRetryableMaintenanceError(error){
 return NON_RETRYABLE_CODES.has(String(error?.code||''));
}

export function createAutopilotAttemptPrompt(task,{attempt=1}={}){
 const text=String(task??'').trim();
 if(attempt<=1)return text;
 return [
  text,
  '',
  '[AUTOPILOT RETRY]',
  'Percobaan sebelumnya gagal pada executor atau verifikasi deterministik.',
  'Perubahan percobaan sebelumnya sudah di-rollback oleh maintenance transaction.',
  'Jangan memperluas scope. Inspeksi ulang akar masalah, buat patch minimal, dan jalankan test relevan.'
 ].join('\n');
}

export function autopilotSnapshot(){
 return Object.freeze({
  version:AI_MAINTENANCE_AUTOPILOT_VERSION,
  mode:'BOUNDED_REPAIR',
  maxAttempts:AI_MAINTENANCE_AUTOPILOT_MAX_ATTEMPTS,
  verifyCommand:'npm run verify',
  verifyTimeoutMs:AI_MAINTENANCE_AUTOPILOT_VERIFY_TIMEOUT_MS,
  backgroundDaemon:false,
  ownerAuthority:false,
  releaseAuthority:false,
  directMainWrite:false
 });
}
