export const AI_MAINTENANCE_POLICY_VERSION='1.1.0';

export const AI_MAINTENANCE_ALLOWED_CAPABILITIES=Object.freeze([
 'program.read',
 'program.edit',
 'program.test',
 'program.build',
 'program.debug',
 'program.rollback',
 'ci.inspect',
 'ci.repair',
 'runtime.health.read',
 'git.diff.inspect'
]);

export const AI_MAINTENANCE_DENIED_CAPABILITIES=Object.freeze([
 'owner.identity.manage',
 'owner.ownership.grant',
 'owner.ownership.revoke',
 'owner.credentials.change',
 'owner.security.root',
 'owner.creator-final-approval',
 'access.grant',
 'access.revoke',
 'credential.read',
 'credential.write',
 'secret.read',
 'secret.write',
 'release.publish',
 'release.signing.manage',
 'git.push',
 'git.merge',
 'git.branch.switch',
 'system.root',
 'system.security.disable'
]);

const FORBIDDEN_WORK_INTENTS=Object.freeze([
 Object.freeze({
  code:'CREDENTIAL_MUTATION',
  pattern:/\b(?:ubah|change|ganti|replace|reset|set|simpan|store|tanam|embed|hardcode|hapus|delete)\b[\s\S]{0,80}\b(?:password|credential|credentials|secret|api\s*key|token)\b/i
 }),
 Object.freeze({
  code:'OWNER_AUTHORITY_MUTATION',
  pattern:/\b(?:buat|create|tambah|tambahkan|menambah|menambahkan|add|ubah|change|ganti|replace|hapus|delete|grant|beri|promote|jadikan)\b[\s\S]{0,80}\b(?:owner|creator|root\s+authority|ownership|kepemilikan)\b/i
 }),
 Object.freeze({
  code:'ACCESS_AUTHORITY_MUTATION',
  pattern:/\b(?:grant|beri|tambahkan|add|cabut|revoke|ubah|change)\b[\s\S]{0,80}\b(?:permission|izin|akses|access|role|authority|privilege)\b/i
 }),
 Object.freeze({
  code:'RELEASE_AUTHORITY_ACTION',
  pattern:/\b(?:git\s+push|git\s+merge|gh\s+release|npm\s+publish|publish\s+release|trigger\s+release|jalankan\s+release|dispatch\s+release)\b/i
 }),
 Object.freeze({
  code:'SECURITY_BOUNDARY_BYPASS',
  pattern:/\b(?:bypass|disable|matikan|turn\s+off)\b[\s\S]{0,60}\b(?:security|auth|authentication|firewall|permission|sandbox|approval|proteksi|protection)\b/i
 }),
 Object.freeze({
  code:'ROOT_PRIVILEGE_ACTION',
  pattern:/\b(?:root|sudo|administrator)\b[\s\S]{0,60}\b(?:takeover|ambil\s+alih|bypass|grant|beri|escalat|naikkan\s+privilege)\b/i
 })
]);

export const AI_MAINTENANCE_READ_DENIED_AREAS=Object.freeze([
 '.env*',
 '**/.env*',
 '.npmrc',
 '**/.npmrc',
 '.npmrc.*',
 '**/.npmrc.*',
 '**/*.pem',
 '**/*.key',
 '**/*.p12',
 '**/*.pfx',
 '**/*.jks',
 '**/*.keystore',
 '**/credentials.json',
 '**/credentials.*.json',
 '**/secrets.json',
 '**/secrets.*.json'
]);

export const AI_MAINTENANCE_PROTECTED_AREAS=Object.freeze([
 '.git/**',
 '.env*',
 '**/.env*',
 '**/*.pem',
 '**/*.key',
 '**/*.p12',
 '**/*.pfx',
 '**/*.jks',
 '**/*.keystore',
 '.github/workflows/**',
 '.gitignore',
 '.gitattributes',
 '.npmrc',
 '**/.npmrc',
 '.npmrc.*',
 '**/.npmrc.*',
 'package.json',
 'package-lock.json',
 'npm-shrinkwrap.json',
 'pnpm-lock.yaml',
 'yarn.lock',
 'bun.lock',
 'bun.lockb',
 'electron-builder.yml',
 'electron-builder.yaml',
 'scripts/humanale-release-publication-gate.mjs',
 'scripts/humanale-release-security.ps1',
 'desktop/agent-maintenance-policy.mjs',
 'desktop/agent-maintenance-guard.mjs',
 'desktop/agent-maintenance-transaction.mjs',
 'desktop/agent-hub.mjs',
 'desktop/terminal-policy.mjs',
 'desktop/main.cjs',
 'desktop/bridge.mjs',
 'desktop/copilot.mjs',
 'desktop/openai-api.mjs',
 'desktop/claude.mjs',
 'desktop/grok.mjs',
 'desktop/gemini.mjs',
 'desktop/deepseek.mjs',
 'desktop/askcodi.mjs',
 'nara-cloud/src/scripts/createOwner.ts',
 'nara-cloud/src/services/owner.service.ts',
 'nara-cloud/src/middleware/requireAuth.ts',
 'nara-cloud/src/sessions/sessions.ts',
 'nara-cloud/src/security/password.ts',
 'nara-cloud/src/config/env.ts',
 'nara-core/permissions/**',
 'nara-core/readiness/**',
 'nara-core/integration/**',
 'public/humanale-final-readiness.js',
 'scripts/humanale-final-evidence.mjs',
 'docs/humanale-final-readiness-certificate.json',
 'docs/humanale-final-readiness*.md',
 'tests/agent-maintenance-policy.test.mjs',
 'tests/agent-maintenance-guard.test.mjs',
 'tests/agent-maintenance-transaction.test.mjs',
 'tests/agent-orchestrator.test.mjs',
 'tests/humanale-final-readiness.test.mjs'
]);

function freezeResult(value){
 return Object.freeze({
  ...value,
  allowedCapabilities:AI_MAINTENANCE_ALLOWED_CAPABILITIES,
  deniedCapabilities:AI_MAINTENANCE_DENIED_CAPABILITIES,
  protectedAreas:AI_MAINTENANCE_PROTECTED_AREAS,
  readDeniedAreas:AI_MAINTENANCE_READ_DENIED_AREAS
 });
}

export function evaluateMaintenanceTask(task,{mode='work'}={}){
 const text=String(task??'').trim();
 if(!text||text.length>4000){
  return freezeResult({
   allowed:false,
   mode,
   reason:'INVALID_TASK',
   matchedRule:null
  });
 }

 if(mode!=='work'){
  return freezeResult({
   allowed:true,
   mode:'analyze',
   reason:'READ_ONLY_ANALYSIS',
   matchedRule:null
  });
 }

 for(const rule of FORBIDDEN_WORK_INTENTS){
  if(rule.pattern.test(text)){
   return freezeResult({
    allowed:false,
    mode:'work',
    reason:'DENIED_BY_MAINTENANCE_POLICY',
    matchedRule:rule.code
   });
  }
 }

 return freezeResult({
  allowed:true,
  mode:'work',
  reason:'MAINTENANCE_ONLY',
  matchedRule:null
 });
}

export function assertMaintenanceTaskAllowed(task,options={}){
 const result=evaluateMaintenanceTask(task,options);
 if(!result.allowed){
  const error=new Error('Permintaan diblokir oleh AI Maintenance Boundary: '+(result.matchedRule||result.reason));
  error.code='AI_MAINTENANCE_BOUNDARY_BLOCKED';
  error.policy=result;
  throw error;
 }
 return result;
}

export function buildMaintenanceWorkPrompt(task){
 assertMaintenanceTaskAllowed(task,{mode:'work'});
 return [
  '[HUMANALE AI MAINTENANCE BOUNDARY v1]',
  'Peran: teknisi perbaikan program. Bukan Owner, bukan administrator kepemilikan.',
  'Scope: hanya checkout Git proyek yang dipilih secara eksplisit.',
  'Capability yang diizinkan: '+AI_MAINTENANCE_ALLOWED_CAPABILITIES.join(', ')+'.',
  'Capability yang selalu dilarang: '+AI_MAINTENANCE_DENIED_CAPABILITIES.join(', ')+'.',
  'Jangan mengubah Owner/Creator identity, password, credential, secret, API key, ownership, access grants, Creator Final Approval, signing authority, atau release publication.',
  'Jangan git push, git merge, publish, mengganti branch, menaikkan privilege, menonaktifkan security/sandbox, atau mengakses data di luar proyek.',
  'Jangan membaca file secret lokal: '+AI_MAINTENANCE_READ_DENIED_AREAS.join(', ')+'.',
  'Jangan mengedit area dilindungi: '+AI_MAINTENANCE_PROTECTED_AREAS.join(', ')+'.',
  'Boleh membaca/edit source program yang tidak dilindungi, memperbaiki bug, refactor seperlunya, menjalankan test/build yang diizinkan, dan melaporkan diff serta hasil verifikasi.',
  'Jika tugas memerlukan capability terlarang, berhenti dan laporkan kebutuhan Owner; jangan mencari jalan lain.',
  '',
  'Tugas:',
  String(task).trim()
 ].join('\n');
}

export function maintenancePolicySnapshot(){
 return Object.freeze({
  version:AI_MAINTENANCE_POLICY_VERSION,
  mode:'REPAIR_ONLY',
  ownerAuthority:false,
  selfPrivilegeEscalation:false,
  autoApproval:false,
  releaseAuthority:false,
  allowedCapabilities:AI_MAINTENANCE_ALLOWED_CAPABILITIES,
  deniedCapabilities:AI_MAINTENANCE_DENIED_CAPABILITIES,
  protectedAreas:AI_MAINTENANCE_PROTECTED_AREAS,
  readDeniedAreas:AI_MAINTENANCE_READ_DENIED_AREAS
 });
}
