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

test('signed candidate builds cannot publish and publication keeps its gate',async()=>{
 const [verify,android]=await Promise.all([
  readFile(new URL('.github/workflows/verify.yml',root),'utf8'),
  readFile(new URL('.github/workflows/android-apk.yml',root),'utf8')
 ]);
 const windowsBuild=verify.split(/\r?\n  windows:\r?\n/)[1]?.split(/\r?\n  release-windows:\r?\n/)[0];
 const windowsPublish=verify.split(/\r?\n  release-windows:\r?\n/)[1];
 const androidBuild=android.split(/\r?\n  release:\r?\n/)[1]?.split(/\r?\n  publish-android:\r?\n/)[0];
 const androidPublish=android.split(/\r?\n  publish-android:\r?\n/)[1];
 for(const [workflow,build,publish] of [[verify,windowsBuild,windowsPublish],[android,androidBuild,androidPublish]]){
  assert.match(workflow,/build_signed_artifact:[\s\S]*?default: false/);
  assert.ok(build && publish,'separate signed-build and publication jobs are required');
  assert.match(build,/inputs\.build_signed_artifact \|\| inputs\.publish_release/);
  assert.match(build,/refs\/heads\/main/);
  assert.doesNotMatch(build,/humanale-release-publication-gate\.mjs|gh release (create|upload)/);
  assert.match(publish,/if: github\.event_name == 'workflow_dispatch' && inputs\.publish_release/);
  assert.match(publish,/Enforce release publication gate[\s\S]*?Download/);
  assert.match(publish,/humanale-release-publication-gate\.mjs/);
  assert.match(publish,/gh release (create|upload)/);
 }
 assert.match(androidBuild,/permissions:\s*\n\s*contents: read/);
 assert.match(androidPublish,/permissions:\s*\n\s*contents: write/);
 assert.match(windowsBuild,/Verify Windows Authenticode/);
 assert.match(androidBuild,/Sign and verify production APK/);
});
