import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {androidVersionFromPackageVersion} from '../scripts/android-version.mjs';

test('Android version metadata follows the root package semver',async()=>{
 assert.deepEqual(androidVersionFromPackageVersion('2.5.0'),{versionName:'2.5.0',versionCode:2_005_000});
 assert.deepEqual(androidVersionFromPackageVersion('12.34.56'),{versionName:'12.34.56',versionCode:12_034_056});
 const prepare=await readFile(new URL('../scripts/prepare-android.mjs',import.meta.url),'utf8');
 assert.match(prepare,/readFile\('package\.json'/);
 assert.match(prepare,/replace\(\/versionCode/);
 assert.match(prepare,/replace\(\/versionName/);
});

test('Android version metadata rejects ambiguous or unsupported versions',()=>{
 for(const value of ['', '2.5', 'v2.5.0', '2.5.0-beta', '2.1000.0', '2.0.1000']){
  assert.throws(()=>androidVersionFromPackageVersion(value));
 }
});
