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