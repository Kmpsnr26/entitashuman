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
 'ALECORE-AI/permissions/**'
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
  ALECORE_AI_STUDIO_PORT:'4178'
 });
 assert.equal(result.env.PATH,'C:\\Windows');
 assert.equal(result.env.USERPROFILE,'C:\\Users\\owner');
 assert.equal(result.removed.includes('USERPROFILE'),false);
 assert.equal(result.env.GITHUB_COPILOT_CLI_PATH,'C:\\Tools\\copilot.exe');
 assert.equal(result.env.ALECORE_AI_STUDIO_PORT,'4178');
 assert.equal(result.env.NO_COLOR,'1');
 for(const key of [
  'OPENAI_API_KEY','GITHUB_TOKEN','AUTH_SESSION_SECRET',
  'DATABASE_URL','SSH_AUTH_SOCK'
 ]){
  assert.equal(Object.hasOwn(result.env,key),false,key);
  assert.ok(result.removed.includes(key),key);
 }
});

test('maintenance environment strips credential references with prefixes suffixes and mixed case',()=>{
 const sensitiveKeys=[
  'TOKEN','TOKEN_','EXAMPLE_TOKEN_FILE','AZURE_FEDERATED_TOKEN_FILE',
  'ALECORE_AI_ACCESS_TOKEN_FILE_PATH_V2','EXAMPLE_SECRET_PATH','AWS_SECRET_ACCESS_KEY_FILE',
  'PASSWORD_FILE','DB_PASSWD_PATH','SERVICE_PWD_FILE',
  'OPENAI_API_KEY_PATH','PROVIDER_APIKEY_FILE',
  'AUTHORIZATION_FILE','COOKIE_JAR_PATH',
  'SERVICE_CREDENTIAL_FILE','SERVICE_CREDENTIALS_DIRECTORY',
  'SSH_PRIVATE_KEY_PATH','OAUTH_CLIENT_SECRET_FILE','OAUTH_REFRESH_TOKEN_PATH',
  'APP_PEPPER_FILE','RELEASE_SIGNING_KEY_PATH','ANDROID_KEYSTORE_FILE',
  'CLIENT_CERTIFICATE_PATH',
  'DATABASE_URL','SSH_AUTH_SOCK','SSH_AGENT_PID','GPG_AGENT_INFO',
  'GOOGLE_APPLICATION_CREDENTIALS','DOCKER_AUTH_CONFIG','NPM_CONFIG__AUTH',
  'azure_federated_token_file','Example_Secret_Path','OpenAi_Api_Key_File'
 ];
 const benignValues={
  PATH:'/usr/bin',
  USERPROFILE:'C:\\Users\\owner',
  PORT:4178,
  NODE_ENV:'test',
  TOKENIZER_MODEL_PATH:'/models/tokenizer',
  SECRETARY_NAME:'assistant',
  COOKIECUTTER_TEMPLATE:'default',
  MY_TOKENIZER_MODEL_PATH:'/models/tokenizer',
  MY_SECRETARY_NAME:'assistant',
  GITHUB_COPILOT_CLI_PATH:'/tools/copilot',
  ALECORE_AI_STUDIO_PORT:'4178'
 };
 const input=Object.freeze({
  ...benignValues,
  ...Object.fromEntries(sensitiveKeys.map(key=>[key,'synthetic-credential-reference']))
 });
 const before={...input};
 const result=sanitizeMaintenanceEnvironment(input);

 for(const key of sensitiveKeys){
  assert.equal(Object.hasOwn(result.env,key),false,key);
 }
 for(const [key,value] of Object.entries(benignValues)){
  assert.equal(result.env[key],String(value),key);
 }
 assert.deepEqual(result.removed,[...sensitiveKeys].sort());
 assert.equal(new Set(result.removed).size,result.removed.length);
 assert.deepEqual(input,before);
 assert.ok(Object.isFrozen(result.env));
 assert.ok(Object.isFrozen(result.removed));
});

test('credential file references stay excluded when maintenance uses an isolated home',()=>{
 const result=sanitizeMaintenanceEnvironment({
  HOME:'/home/owner',
  AZURE_FEDERATED_TOKEN_FILE:'/synthetic/azure-token',
  example_secret_path:'/synthetic/secret',
  PATH:'/usr/bin',
  TOKENIZER_MODEL_PATH:'/models/tokenizer'
 },{isolatedHome:'/tmp/humanale-isolated-test'});
 assert.equal(result.env.HOME,'/tmp/humanale-isolated-test');
 assert.equal(result.env.USERPROFILE,'/tmp/humanale-isolated-test');
 assert.equal(result.env.PATH,'/usr/bin');
 assert.equal(result.env.TOKENIZER_MODEL_PATH,'/models/tokenizer');
 assert.equal(Object.hasOwn(result.env,'AZURE_FEDERATED_TOKEN_FILE'),false);
 assert.equal(Object.hasOwn(result.env,'example_secret_path'),false);
 assert.deepEqual(result.removed,['AZURE_FEDERATED_TOKEN_FILE','HOME','example_secret_path']);
});

test('maintenance environment strips suffixed credential names without removing unrelated runtime variables',()=>{
 const sensitiveKeys=[
  'TOKEN_FILE','GITHUB_TOKEN_FILE','AUTH_SESSION_SECRET_PATH',
  'DATABASE_PASSWORD_FILE','DB_PASSWD_PATH','SERVICE_PWD_FILE',
  'OPENAI_API_KEY_FILE','SERVICE_APIKEY_PATH','AUTHORIZATION_HEADER',
  'COOKIE_JAR','CREDENTIAL_FILE','CREDENTIALS_PATH','PRIVATE_KEY_FILE',
  'CLIENT_SECRET_VERSION_2','REFRESH_TOKEN_PATH','AWS_ACCESS_KEY_ID',
  'PEPPER_FILE','SIGNING_KEY_PATH','KEYSTORE_PATH','CERTIFICATE_FILE',
  'github_token_file'
 ];
 const baseEnv={
  PATH:'/usr/bin',
  ALECORE_AI_STUDIO_PORT:'4178',
  TOKENIZER_MODEL:'local',
  GITHUB_COPILOT_CLI_PATH:'/usr/bin/copilot',
  ...Object.fromEntries(sensitiveKeys.map(key=>[key,'sensitive-test-value']))
 };
 const result=sanitizeMaintenanceEnvironment(baseEnv);
 for(const key of sensitiveKeys){
  assert.equal(Object.hasOwn(result.env,key),false,key);
 }
 assert.deepEqual(result.removed,[...sensitiveKeys].sort());
 for(const key of ['PATH','ALECORE_AI_STUDIO_PORT','TOKENIZER_MODEL','GITHUB_COPILOT_CLI_PATH']){
  assert.equal(result.env[key],baseEnv[key],key);
 }
 assert.equal(baseEnv.GITHUB_TOKEN_FILE,'sensitive-test-value');
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
 assert.equal(isMaintenanceProtectedPath('alecore-ai-cloud/.env.local',protectedAreas),true);
 assert.equal(isMaintenanceProtectedPath('.github/workflows/release.yml',protectedAreas),true);
 assert.equal(isMaintenanceProtectedPath('DESKTOP/agent-maintenance-policy.mjs',protectedAreas),true);
 assert.equal(isMaintenanceProtectedPath('ALECORE-AI/permissions/index.js',protectedAreas),true);
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

test('patch inspection rejects complete credential-reference identifiers in dot and bracket access',()=>{
 const keys=[
  'TOKEN','EXAMPLE_TOKEN_FILE','AZURE_FEDERATED_TOKEN_FILE',
  'EXAMPLE_SECRET_PATH','AWS_SECRET_ACCESS_KEY_FILE','OpenAi_Api_Key_File',
  'example_credentials_directory','RELEASE_SIGNING_KEY_PATH',
  'CLIENT_CERTIFICATE_PATH','SERVICE_PWD_FILE','DATABASE_URL',
  'SSH_AUTH_SOCK','SSH_AGENT_PID','GPG_AGENT_INFO','DOCKER_AUTH_CONFIG','NPM_CONFIG__AUTH'
 ];
 for(const key of keys){
  for(const access of [
   `process.env.${key}`,
   `process.env . ${key}`,
   `process.env?.${key}`,
   `process.env['${key}']`,
   `process.env [ "${key}" ]`,
   `process.env?.['${key}']`
  ]){
   const result=inspectMaintenancePatchText(`--- a/app.mjs\n+++ b/app.mjs\n+const value=${access};`);
   assert.equal(result.allowed,false,access);
   assert.deepEqual(result.violations,['SECRET_ENV_ACCESS_ADDED'],access);
  }
 }
});

test('patch inspection fails closed on credential literals used in bracket expressions',()=>{
 for(const expression of [
  "process.env['TOKEN' + '_FILE']",
  'process.env["OPENAI_API_KEY" + ""]',
  "process.env?.['EXAMPLE_SECRET_PATH' + suffix]",
  "process.env['TOKEN' || fallback]"
 ]){
  const result=inspectMaintenancePatchText(`+const value=${expression};`);
  assert.equal(result.allowed,false,expression);
  assert.deepEqual(result.violations,['SECRET_ENV_ACCESS_ADDED'],expression);
 }
 assert.equal(inspectMaintenancePatchText(
  "+const value=process.env['TOKENIZER_MODEL_PATH' + suffix];"
 ).allowed,true);
});

test('patch inspection preserves the fail-closed sensitive-prefix boundary before literal escapes',()=>{
 for(const expression of [
  String.raw`process.env['TOKEN\x5fFILE']`,
  String.raw`process.env["OPENAI_API_KEY\u005fPATH"]`,
  String.raw`process.env['EXAMPLE_SECRET\u{005f}PATH']`,
  String.raw`process.env?.['example_token\x5fFILE']`,
  String.raw`process.env['TOKEN\x5f' + 'FILE']`
 ]){
  const result=inspectMaintenancePatchText(`+const value=${expression};`);
  assert.equal(result.allowed,false,expression);
  assert.deepEqual(result.violations,['SECRET_ENV_ACCESS_ADDED'],expression);
 }
 for(const expression of [
  String.raw`process.env['TOKENIZER\x5fMODEL']`,
  String.raw`process.env["SECRETARY\u005fNAME"]`,
  String.raw`process.env['TOKEN$MODEL\x5fPATH']`
 ]){
  assert.equal(inspectMaintenancePatchText(`+const value=${expression};`).allowed,true,expression);
 }
});

test('patch inspection preserves benign complete identifiers and scans added access only',()=>{
 for(const key of [
  'TOKENIZER_MODEL_PATH','SECRETARY_NAME','COOKIECUTTER_TEMPLATE',
  'MY_TOKENIZER_MODEL_PATH','MY_SECRETARY_NAME','GITHUB_COPILOT_CLI_PATH',
  'DATABASE_URL_OPTIONS','TOKEN$MODEL','TOKEN\u03c0','TOKEN\u200cMODEL'
 ]){
  for(const access of [
   `process.env.${key}`,`process.env['${key}']`,
   `process.env?.${key}`,`process.env?.['${key}']`
  ]){
   const result=inspectMaintenancePatchText(`+const value=${access};`);
   assert.equal(result.allowed,true,access);
   assert.deepEqual(result.violations,[],access);
  }
 }
 assert.equal(inspectMaintenancePatchText(
  '-const previous=process.env.EXAMPLE_TOKEN_FILE;\n'+
  ' const context=process.env["EXAMPLE_SECRET_PATH"];\n'+
  '+const safe=process.env.TOKENIZER_MODEL_PATH;'
 ).allowed,true);
});

test('near-limit credential-like identifiers do not cause excessive regex backtracking',()=>{
 const largeBenignKey='TOKEN_'.repeat(320000)+'TAIL$MODEL';
 const start=performance.now();
 const inspection=inspectMaintenancePatchText(`+const value=process.env.${largeBenignKey};`);
 const sanitized=sanitizeMaintenanceEnvironment({[largeBenignKey]:'ordinary-value'});
 const elapsed=performance.now()-start;
 assert.equal(inspection.allowed,true);
 assert.equal(sanitized.env[largeBenignKey],'ordinary-value');
 assert.deepEqual(sanitized.removed,[]);
 assert.ok(elapsed<1000,`credential-name inspection took ${elapsed.toFixed(1)}ms`);
});

test('changeset blocks protected paths symlinks staging drift and excessive scope',()=>{
 const result=evaluateMaintenanceChangeSet({
  paths:['public/app.js','desktop/agent-maintenance-policy.mjs'],
  protectedAreas,
  symlinkPaths:['public/link.js'],
  stagedPaths:['public/app.js'],
  secretPaths:['.env'],
  totalBytes:AI_MAINTENANCE_MAX_CHANGED_BYTES+1,
  branchChanged:true,
  headChanged:true,
  gitMetadataChanged:true,
  lockChanged:true,
  patch:'--- a/public/app.js\n+++ b/public/app.js\n+const x=1;'
 });
 assert.equal(result.allowed,false);
 for(const code of [
  'BRANCH_DRIFT','HEAD_DRIFT','GIT_METADATA_DRIFT','REPO_LOCK_DRIFT','STAGED_CHANGE',
  'SYMLINK_CHANGE','SECRET_FILE_CREATED','PROTECTED_PATH_CHANGE','CHANGESET_TOO_LARGE'
 ]){
  assert.ok(result.violations.includes(code),code);
 }
 assert.deepEqual(result.protectedPaths,['desktop/agent-maintenance-policy.mjs']);
 assert.deepEqual(result.secretPaths,['.env']);
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
  'alecore-ai-cloud/.env.local',
  '.env.staging',
  'apps/web/.env.development',
  'keys/release-signing.pfx',
  'android/upload.keystore',
  'config/credentials.json'
 ];
 const patterns=[
  '.env*','**/.env*',
  '**/*.pfx','**/*.keystore','**/credentials.json'
 ];
 for(const path of denied){
  assert.equal(isMaintenanceReadDeniedPath(path,patterns),true,path);
 }
 assert.equal(isMaintenanceReadDeniedPath('.env.example',patterns),false);
 assert.equal(isMaintenanceReadDeniedPath('config/.env.template',patterns),false);
 assert.equal(isMaintenanceReadDeniedPath('public/app.js',patterns),false);
});


test('isolated maintenance environment replaces user profile locations and disables interactive credential prompts',()=>{
 const result=sanitizeMaintenanceEnvironment({
  PATH:'/usr/bin',
  HOME:'/home/owner',
  USERPROFILE:'C:\\Users\\Owner',
  APPDATA:'C:\\Users\\Owner\\AppData\\Roaming',
  LOCALAPPDATA:'C:\\Users\\Owner\\AppData\\Local',
  GH_TOKEN:'secret-gh',
  NORMAL_FLAG:'ok'
 },{isolatedHome:'/tmp/humanale-ai-home-test'});

 assert.equal(result.env.HOME,'/tmp/humanale-ai-home-test');
 assert.equal(result.env.USERPROFILE,'/tmp/humanale-ai-home-test');
 assert.equal(result.env.XDG_CONFIG_HOME,'/tmp/humanale-ai-home-test/config');
 assert.equal(result.env.XDG_CACHE_HOME,'/tmp/humanale-ai-home-test/cache');
 assert.equal(result.env.GIT_TERMINAL_PROMPT,'0');
 assert.equal(result.env.GCM_INTERACTIVE,'Never');
 assert.equal(result.env.NORMAL_FLAG,'ok');
 assert.equal(Object.hasOwn(result.env,'GH_TOKEN'),false);
 if(process.platform==='win32'){
  assert.equal(result.env.APPDATA,'/tmp/humanale-ai-home-test/AppData/Roaming');
  assert.equal(result.env.LOCALAPPDATA,'/tmp/humanale-ai-home-test/AppData/Local');
 }else{
  assert.equal(Object.hasOwn(result.env,'APPDATA'),false);
  assert.equal(Object.hasOwn(result.env,'LOCALAPPDATA'),false);
 }
 assert.ok(result.removed.includes('HOME'));
 assert.ok(result.removed.includes('USERPROFILE'));
 assert.ok(result.removed.includes('APPDATA'));
 assert.ok(result.removed.includes('LOCALAPPDATA'));
});
