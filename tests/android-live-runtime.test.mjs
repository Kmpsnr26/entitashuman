import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {prepareAndroidRuntime} from '../scripts/android/prepare-runtime.mjs';
import {prepareAndroidVoice} from '../scripts/android/prepare-voice.mjs';
const run=promisify(execFile);
const appId='id.my.aleprinting.humanale';
const javaPackage=appId.replaceAll('.','/');

test('Android live viewer generation is idempotent, narrowly allows loopback, and preserves voice',async t=>{
  const root=await mkdtemp(join(tmpdir(),'humanale-runtime-prepare-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const main=join(root,'android/app/src/main');
  const activity=join(main,'java',javaPackage,'MainActivity.java');
  await mkdir(dirname(activity),{recursive:true});
  await writeFile(join(root,'capacitor.config.json'),JSON.stringify({appId,server:{androidScheme:'https'}}));
  await writeFile(activity,`package ${appId};\nimport com.getcapacitor.BridgeActivity;\npublic class MainActivity extends BridgeActivity {}`);
  await writeFile(join(main,'AndroidManifest.xml'),'<manifest><application android:usesCleartextTraffic="true"></application></manifest>');
  await prepareAndroidVoice(root);
  await prepareAndroidRuntime(root);
  const initial=await readFile(activity,'utf8');
  await prepareAndroidVoice(root);
  await prepareAndroidRuntime(root);
  assert.equal(await readFile(activity,'utf8'),initial);
  assert.match(initial,/registerPlugin\(HumanALEVoicePlugin.class\)/);
  assert.equal(initial.match(/registerPlugin\(HumanALERuntimePlugin.class\)/g).length,1);
  assert.ok(initial.indexOf('registerPlugin(HumanALERuntimePlugin.class)')<initial.indexOf('super.onCreate'));
  const manifest=await readFile(join(main,'AndroidManifest.xml'),'utf8');
  assert.equal(manifest.match(/android:name=".RuntimeActivity"/g).length,1);
  assert.match(manifest,/android:exported="false"/);
  assert.match(manifest,/android:usesCleartextTraffic="false"/);
  const network=await readFile(join(main,'res/xml/humanale_runtime_network_security.xml'),'utf8');
  assert.match(network,/<base-config cleartextTrafficPermitted="false"/);
  assert.deepEqual([...network.matchAll(/<domain includeSubdomains="false">([^<]+)<\/domain>/g)].map(m=>m[1]),['localhost','127.0.0.1','::1']);
  await writeFile(join(root,'capacitor.config.json'),JSON.stringify({appId,server:{url:'https://remote.example'}}));
  await assert.rejects(prepareAndroidRuntime(root),/bundled https:\/\/localhost/);
});

const doubles={
  'android/content/Intent.java':`package android.content;public class Intent { public final java.util.Map<String,String> extras=new java.util.HashMap<>();public Intent(Object context,Class<?> type){}public Intent putExtra(String key,String value){extras.put(key,value);return this;} }`,
  'android/app/Activity.java':`package android.app;import android.content.Intent;public class Activity {public Intent started;public void runOnUiThread(Runnable r){r.run();}public void startActivity(Intent i){started=i;} }`,
  'android/webkit/WebView.java':'package android.webkit;public class WebView {public String url="https://localhost/index.html";public String getUrl(){return url;} }',
  'com/getcapacitor/Bridge.java':'package com.getcapacitor;public class Bridge {public final android.webkit.WebView view=new android.webkit.WebView();public android.webkit.WebView getWebView(){return view;} }',
  'com/getcapacitor/JSObject.java':'package com.getcapacitor;public class JSObject extends java.util.HashMap<String,Object>{}',
  'com/getcapacitor/PluginCall.java':`package com.getcapacitor;public class PluginCall {public final JSObject input=new JSObject();public JSObject value;public String error;public String getString(String k,String d){Object v=input.get(k);return v instanceof String?(String)v:d;}public void reject(String msg,String code){error=code;}public void resolve(JSObject v){value=v;} }`,
  'com/getcapacitor/Plugin.java':'package com.getcapacitor;public class Plugin {public final android.app.Activity activity=new android.app.Activity();public final Bridge bridge=new Bridge();public android.app.Activity getActivity(){return activity;}public Bridge getBridge(){return bridge;} }',
  'com/getcapacitor/PluginMethod.java':'package com.getcapacitor;public @interface PluginMethod {}',
  'com/getcapacitor/annotation/CapacitorPlugin.java':'package com.getcapacitor.annotation;public @interface CapacitorPlugin {String name();}',
  [`${javaPackage}/RuntimeActivity.java`]:`package ${appId};public class RuntimeActivity {public static final String EXTRA_URL="url",EXTRA_AUTH_ORIGIN="authOrigin";}`,
  [`${javaPackage}/RuntimeHarness.java`]:`package ${appId};import com.getcapacitor.PluginCall;public class RuntimeHarness {
    static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
    static void rejects(String url){try{RuntimeUrlPolicy.parse(url);throw new AssertionError("accepted "+url);}catch(IllegalArgumentException expected){}}
    public static void main(String[] args){
      for(String url:new String[]{"http://127.0.0.1:4178/","http://localhost:4200/","http://[::1]:4178/","https://nara.aleprinting.my.id/","https://example.com:65535/?x=1"})RuntimeUrlPolicy.parse(url);
      for(String url:new String[]{"http://192.168.1.1/","http://127.0.0.2/","http://127.1/","http://2130706433/","http://localhost.evil/","http://localhost./","https://user:pass@example.com/","https://example.com:0/","https://example.com:65536/","https://example.com:/","https://example.com:abc/","https://evil\\\\@localhost/","https://localhost\\n.evil/","https://%6cocalhost/","javascript:alert(1)","file:///tmp/a","content://a/","data:text/html,test","intent://a/","//localhost:4178/"})rejects(url);
      check(RuntimeUrlPolicy.isLocalApp("https://localhost/index.html"),"bundled origin allowed");
      check(RuntimeUrlPolicy.isLocalApp("https://localhost:443/index.html"),"default HTTPS port allowed");
      for(String url:new String[]{"http://localhost/","https://localhost:4178/","https://127.0.0.1/","https://localhost.evil/","https://user@localhost/"})check(!RuntimeUrlPolicy.isLocalApp(url),"remote origin cannot invoke plugin");
      check(RuntimeUrlPolicy.sameOrigin(RuntimeUrlPolicy.parse("https://EXAMPLE.com/"),"https://example.com:443/auth"),"canonical same origin");
      check(!RuntimeUrlPolicy.sameOrigin(RuntimeUrlPolicy.parse("https://example.com/"),"https://example.com:4178/auth"),"ports identify origin");
      HumanALERuntimePlugin plugin=new HumanALERuntimePlugin();PluginCall valid=new PluginCall();valid.input.put("url","http://localhost:4200");valid.input.put("authOrigin","http://127.0.0.1:4100/login");plugin.open(valid);
      check(valid.value!=null&&Boolean.TRUE.equals(valid.value.get("opened")),"opens actual Activity");
      check(!valid.value.containsKey("connected"),"opening is never represented as connected");
      check("http://127.0.0.1:4100".equals(plugin.activity.started.extras.get(RuntimeActivity.EXTRA_AUTH_ORIGIN)),"auth origin explicit and canonical");
      PluginCall bad=new PluginCall();bad.input.put("url","http://192.168.1.1");plugin.open(bad);check("INVALID_URL".equals(bad.error),"plugin rejects unsafe runtime");
      PluginCall badAuth=new PluginCall();badAuth.input.put("url","https://example.com");badAuth.input.put("authOrigin","http://evil.test");plugin.open(badAuth);check("INVALID_URL".equals(badAuth.error),"auth origin has same security policy");
      plugin.bridge.view.url="https://attacker.test";PluginCall remote=new PluginCall();remote.input.put("url","https://example.com");plugin.open(remote);check("UNTRUSTED_CALLER".equals(remote.error),"remote cannot launch native Activity");
      System.out.println("LIVE_RUNTIME_HARNESS_PASS");
    }
  }`
};

test('Native live viewer executes URL policy and local-only plugin boundary on JVM',async t=>{
  const root=await mkdtemp(join(tmpdir(),'humanale-runtime-jvm-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const javaBin=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin'):null;
  const javac=javaBin?join(javaBin,process.platform==='win32'?'javac.exe':'javac'):'javac';
  const java=javaBin?join(javaBin,process.platform==='win32'?'java.exe':'java'):'java';
  try{await run(javac,['-version']);}catch(error){if(error.code==='ENOENT'){t.skip('JDK unavailable; Android build compiles native source');return;}throw error;}
  const sources=[];
  for(const [path,source] of Object.entries(doubles)){
    const destination=join(root,path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,source);sources.push(destination);
  }
  for(const name of ['RuntimeUrlPolicy','HumanALERuntimePlugin']){
    const destination=join(root,javaPackage,`${name}.java`);
    await writeFile(destination,(await readFile(new URL(`../scripts/android/${name}.java`,import.meta.url),'utf8')).replaceAll('__APP_PACKAGE__',appId));sources.push(destination);
  }
  await run(javac,['-encoding','UTF-8','-d',join(root,'classes'),...sources],{maxBuffer:1024*1024});
  const result=await run(java,['-cp',join(root,'classes'),`${appId}.RuntimeHarness`],{timeout:15000});
  assert.match(result.stdout,/LIVE_RUNTIME_HARNESS_PASS/);
});

test('Remote WebView has no native bridge and never bypasses TLS or grants sensor access',async()=>{
  const source=await readFile(new URL('../scripts/android/RuntimeActivity.java',import.meta.url),'utf8');
  assert.doesNotMatch(source,/extends\s+BridgeActivity|addJavascriptInterface|handler\.proceed\(|request\.grant\(/);
  for(const pattern of [/handler\.cancel\(\)/,/request\.deny\(\)/,/setAllowFileAccess\(false\)/,/setAllowContentAccess\(false\)/,/MIXED_CONTENT_NEVER_ALLOW/,/setAcceptThirdPartyCookies\(webView, false\)/,/request\.isForMainFrame\(\)/])assert.match(source,pattern);
});
