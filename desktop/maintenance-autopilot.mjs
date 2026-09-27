export const AI_MAINTENANCE_AUTOPILOT_VERSION='1.0.0';
export const AI_MAINTENANCE_AUTOPILOT_MAX_ATTEMPTS=2;
export const AI_MAINTENANCE_AUTOPILOT_VERIFY_TIMEOUT_MS=15*60*1000;

const NON_RETRYABLE_CODES=new Set([
 'AI_MAINTENANCE_BOUNDARY_BLOCKED',
 'AI_MAINTENANCE_PROTECTED_PATH',
 'AI_MAINTENANCE_ROLLBACK_FAILED'
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
  'Percobaan sebelumnya gagal pada verifikasi deterministik atau executor.',
  'Worktree sudah di-rollback ke HEAD.',
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
  releaseAuthority:false
 });
}
