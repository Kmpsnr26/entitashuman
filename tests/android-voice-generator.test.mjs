import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareAndroidVoice} from '../scripts/android/prepare-voice.mjs';
const run=promisify(execFile);
async function fixture(t,activity='public class MainActivity extends BridgeActivity {}'){
 const root=await mkdtemp(join(tmpdir(),'humanale-android-voice-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const pkg=join(root,'android/app/src/main/java/id/my/aleprinting/humanale');
 await mkdir(pkg,{recursive:true});
 await writeFile(join(pkg,'MainActivity.java'),'package id.my.aleprinting.humanale;\nimport com.getcapacitor.BridgeActivity;\n'+activity);
 await writeFile(join(root,'capacitor.config.json'),JSON.stringify({appId:'id.my.aleprinting.humanale'}));
 return {root,pkg};
}

test('voice generator registers the local plugin before bridge creation and stays idempotent',async t=>{
 const {root,pkg}=await fixture(t);
 await prepareAndroidVoice(root);
 const first=await readFile(join(pkg,'MainActivity.java'),'utf8');
 assert.ok(first.indexOf('registerPlugin(HumanALEVoicePlugin.class)')<first.indexOf('super.onCreate(savedInstanceState)'));
 await prepareAndroidVoice(root);
 assert.equal(await readFile(join(pkg,'MainActivity.java'),'utf8'),first);
 const plugin=await readFile(join(pkg,'HumanALEVoicePlugin.java'),'utf8');
 assert.ok(plugin.startsWith('package id.my.aleprinting.humanale;'));
 assert.ok(!plugin.includes('__APP_PACKAGE__'));
});

test('voice generator preserves existing activity hooks and another registered plugin',async t=>{
 const body='public class MainActivity extends BridgeActivity { @Override public void onCreate(Bundle state) { registerPlugin(OtherPlugin.class); super.onCreate(state); keepExistingHook(); } }';
 const {root,pkg}=await fixture(t,body);
 await prepareAndroidVoice(root);
 const activity=await readFile(join(pkg,'MainActivity.java'),'utf8');
 assert.equal((activity.match(/onCreate\(Bundle/g)||[]).length,1);
 assert.ok(activity.includes('registerPlugin(OtherPlugin.class)'));
 assert.ok(activity.includes('keepExistingHook();'));
 assert.ok(activity.indexOf('registerPlugin(HumanALEVoicePlugin.class)')<activity.indexOf('super.onCreate(state)'));
});

test('Android preparation retains manifest queries and registers TTS without new permissions',async t=>{
 const {root,pkg}=await fixture(t);
 await cp(new URL('../scripts',import.meta.url),join(root,'scripts'),{recursive:true});
 await writeFile(join(root,'package.json'),JSON.stringify({version:'2.5.0'}));
 const manifest='<manifest xmlns:android="http://schemas.android.com/apk/res/android"><queries><package android:name="existing.package" /></queries><application android:theme="@style/AppTheme"></application></manifest>';
 await writeFile(join(root,'android/app/src/main/AndroidManifest.xml'),manifest);
 await writeFile(join(root,'android/app/build.gradle'),'versionCode 1\nversionName "1.0"');
 await run(process.execPath,['scripts/prepare-android.mjs'],{cwd:root});
 const first=await readFile(join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
 await run(process.execPath,['scripts/prepare-android.mjs'],{cwd:root});
 const second=await readFile(join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
 assert.equal((second.match(/android.intent.action.TTS_SERVICE/g)||[]).length,1);
 assert.equal((second.match(/<queries>/g)||[]).length,1);
 assert.ok(second.includes('existing.package'));
 assert.equal((second.match(/<uses-permission/g)||[]).length,4);
 assert.ok(await readFile(join(pkg,'HumanALEVoicePlugin.java'),'utf8'));
 // Preparation must remain safe when run twice by separate build steps.
 assert.equal(second,first);
});

test('voice generator fails on unsupported customized activity rather than deleting its code',async t=>{
 const {root,pkg}=await fixture(t,'public class MainActivity extends BridgeActivity { void onCreate(Bundle state) { customOnly(); } }');
 const original=await readFile(join(pkg,'MainActivity.java'),'utf8');
 await assert.rejects(prepareAndroidVoice(root),/no supported super call/);
 assert.equal(await readFile(join(pkg,'MainActivity.java'),'utf8'),original);
});
