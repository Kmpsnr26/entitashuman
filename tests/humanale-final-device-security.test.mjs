import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
test('final device/security runners remain evidence-driven and fail closed',async()=>{
 const [android,security]=await Promise.all([
  readFile(new URL('scripts/humanale-android-runtime.ps1',root),'utf8'),
  readFile(new URL('scripts/humanale-release-security.ps1',root),'utf8')
 ]);
 assert.match(android,/humanale-android-runtime\/1/);
 assert.match(android,/install -r/);
 assert.match(android,/operatorPass/);
 assert.match(android,/ANDROID_RUNTIME_PASS/);
 assert.match(security,/Get-AuthenticodeSignature/);
 assert.match(security,/apksigner verify/);
 assert.match(security,/RELEASE_SECURITY_PASS/);
 assert.doesNotMatch(android+security,/integrationUnlocked|authority-control|NARA.*dispatch/i);
});

test('release workflows require final readiness and signed Windows artifacts',async()=>{
 const [verify,android,gate]=await Promise.all([
  readFile(new URL('.github/workflows/verify.yml',root),'utf8'),
  readFile(new URL('.github/workflows/android-apk.yml',root),'utf8'),
  readFile(new URL('scripts/humanale-release-publication-gate.mjs',root),'utf8')
 ]);
 assert.match(verify,/Enforce release publication gate[\s\S]*humanale-release-publication-gate\.mjs/);
 assert.match(android,/Enforce release publication gate[\s\S]*humanale-release-publication-gate\.mjs/);
 assert.match(verify,/WINDOWS_SIGNING_PFX_BASE64/);
 assert.match(verify,/WINDOWS_SIGNING_PFX_PASSWORD/);
 assert.match(verify,/Build signed Windows installer/);
 assert.match(verify,/CSC_LINK/);
 assert.match(verify,/Get-AuthenticodeSignature/);
 assert.match(verify,/signature\.Status -ne "Valid"/);
 assert.match(gate,/FINAL_READY/);
 assert.match(gate,/integrationUnlocked/);
 assert.match(gate,/creatorApproval/);
 assert.match(gate,/githubRefName/);
});
