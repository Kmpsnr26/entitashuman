import test from 'node:test';
import assert from 'node:assert/strict';
import {
 AI_MAINTENANCE_MAX_CHANGED_BYTES,
 evaluateMaintenanceChangeSet,
 extractAddedPatchLines,
 inspectMaintenancePatchText,
 isMaintenanceProtectedPath,
 isMaintenanceReadDeniedPath,
 normalizeMaintenanceRepoPath,
 sanitizeMaintenanceEnvironment
} from '../desktop/agent-maintenance-guard.mjs';

const protectedAreas=[
 '.git/**',
 '.env*',
 '**/.env*',
 '.github/workflows/**',
 'desktop/agent-maintenance-policy.mjs',
 'desktop/agent-maintenance-guard.mjs',
 'nara-core/permissions/**'
];

test('maintenance environment strips credential-bearing variables but preserves ordinary runtime values',()=>{
 const result=sanitizeMaintenanceEnvironment({
  PATH:'C:\\Windows',
  USERPROFILE:'C:\\Users\\owner',
  OPENAI_API_KEY:'secret-openai',
  GITHUB_TOKEN:'secret-github',
  AUTH_SESSION_SECRET:'secret-session',
  DATABASE_URL:'postgres://owner:secret@localhost/db',
  SSH_AUTH_SOCK:'pipe',
  GITHUB_COPILOT_CLI_PATH:'C:\\Tools\\copilot.exe',
  NARA_STUDIO_PORT:'4178'
 });
 assert.equal(result.env.PATH,'C:\\Windows');
 assert.equal(result.env.USERPROFILE,'C:\\Users\\owner');
 assert.equal(result.env.GITHUB_COPILOT_CLI_PATH,'C:\\Tools\\copilot.exe');
 assert.equal(result.env.NARA_STUDIO_PORT,'4178');
 assert.equal(result.env.NO_COLOR,'1');
 for(const key of [
  'OPENAI_API_KEY','GITHUB_TOKEN','AUTH_SESSION_SECRET',
  'DATABASE_URL','SSH_AUTH_SOCK'
 ]){
  assert.equal(Object.hasOwn(result.env,key),false,key);
  assert.ok(result.removed.includes(key),key);
 }
});

test('repo path normalization is fail-closed for traversal absolute paths and runtime globs',()=>{
 assert.equal(normalizeMaintenanceRepoPath('.\\public\\app.js'),'public/app.js');
 assert.throws(()=>normalizeMaintenanceRepoPath('../outside.txt'),/keluar/);
 assert.throws(()=>normalizeMaintenanceRepoPath('C:\\secret.txt'),/relatif/);
 assert.throws(()=>normalizeMaintenanceRepoPath('/etc/passwd'),/relatif/);
 assert.throws(()=>normalizeMaintenanceRepoPath('public/*.js'),/glob/);
});

test('protected path matcher handles root and recursive glob patterns case-insensitively',()=>{
 assert.equal(isMaintenanceProtectedPath('.env.production',protectedAreas),true);
 assert.equal(isMaintenanceProtectedPath('nara-cloud/.env.local',protectedAreas),true);
 assert.equal(isMaintenanceProtectedPath('.github/workflows/release.yml',protectedAreas),true);
 assert.equal(isMaintenanceProtectedPath('DESKTOP/agent-maintenance-policy.mjs',protectedAreas),true);
 assert.equal(isMaintenanceProtectedPath('nara-core/permissions/index.js',protectedAreas),true);
 assert.equal(isMaintenanceProtectedPath('public/avatar.js',protectedAreas),false);
});

test('patch parser scans added lines only',()=>{
 const patch=[
  '--- a/file.mjs',
  '+++ b/file.mjs',
  '-const old=process.env.OPENAI_API_KEY;',
  '+const safe=true;',
  ' context'
 ].join('\n');
 assert.equal(extractAddedPatchLines(patch),'const safe=true;');
 assert.equal(inspectMaintenancePatchText(patch).allowed,true);
});

test('added secret access ownership mutation creator unlock and release authority commands fail closed',()=>{
 const cases=[
  '+const key=process.env.OPENAI_API_KEY;',
  '+await db.query("UPDATE owner_users SET is_active = true");',
  '+creatorApproval = {approved:true, by:"agent"};',
  '+integrationUnlocked=true;',
  '+const cmd="git push origin main";'
 ];
 for(const added of cases){
  const result=inspectMaintenancePatchText('--- a/a\n+++ b/a\n'+added);
  assert.equal(result.allowed,false,added);
  assert.ok(result.violations.length>=1,added);
 }
});

test('changeset blocks protected paths symlinks staging drift and excessive scope',()=>{
 const result=evaluateMaintenanceChangeSet({
  paths:['public/app.js','desktop/agent-maintenance-policy.mjs'],
  protectedAreas,
  symlinkPaths:['public/link.js'],
  stagedPaths:['public/app.js'],
  totalBytes:AI_MAINTENANCE_MAX_CHANGED_BYTES+1,
  branchChanged:true,
  headChanged:true,
  gitMetadataChanged:true,
  patch:'--- a/public/app.js\n+++ b/public/app.js\n+const x=1;'
 });
 assert.equal(result.allowed,false);
 for(const code of [
  'BRANCH_DRIFT','HEAD_DRIFT','GIT_METADATA_DRIFT','STAGED_CHANGE',
  'SYMLINK_CHANGE','PROTECTED_PATH_CHANGE','CHANGESET_TOO_LARGE'
 ]){
  assert.ok(result.violations.includes(code),code);
 }
 assert.deepEqual(result.protectedPaths,['desktop/agent-maintenance-policy.mjs']);
});

test('small unprotected source patch is allowed',()=>{
 const result=evaluateMaintenanceChangeSet({
  paths:['public/avatar.js','tests/avatar.test.mjs'],
  protectedAreas,
  totalBytes:12000,
  patch:'--- a/public/avatar.js\n+++ b/public/avatar.js\n+const blink=true;'
 });
 assert.equal(result.allowed,true);
 assert.deepEqual(result.violations,[]);
});


test('secret-file boundary blocks real secret files while allowing templates',()=>{
 const denied=[
  '.env',
  'nara-cloud/.env.local',
  'keys/release-signing.pfx',
  'android/upload.keystore',
  'config/credentials.json'
 ];
 const patterns=[
  '.env','**/.env','.env.local','**/.env.local',
  '**/*.pfx','**/*.keystore','**/credentials.json'
 ];
 for(const path of denied){
  assert.equal(isMaintenanceReadDeniedPath(path,patterns),true,path);
 }
 assert.equal(isMaintenanceReadDeniedPath('.env.example',patterns),false);
 assert.equal(isMaintenanceReadDeniedPath('config/.env.template',patterns),false);
 assert.equal(isMaintenanceReadDeniedPath('public/app.js',patterns),false);
});
