import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);

// Small API doubles execute the real plugin's state machine on a JVM. APK compilation
// and physical-device audio acceptance separately verify the real Android API layer.
const doubles={
 'android/os/Bundle.java':'package android.os; public class Bundle {}',
 'android/os/Looper.java':'package android.os; public class Looper { public static Looper getMainLooper(){return new Looper();} }',
 'android/os/Handler.java':`package android.os; import java.util.concurrent.ConcurrentLinkedQueue;
 public class Handler { static final ConcurrentLinkedQueue<Runnable> queue=new ConcurrentLinkedQueue<>();
 public Handler(Looper l){} public boolean post(Runnable r){queue.add(r);return true;}
 public boolean postDelayed(Runnable r,long t){return true;} public void removeCallbacks(Runnable r){queue.remove(r);}
 public static void drain(){Runnable r;while((r=queue.poll())!=null)r.run();} }`,
 'android/content/Context.java':`package android.content; import java.io.File;
 public class Context { public File getCacheDir(){return new File(System.getProperty("java.io.tmpdir"));} }`,
 'android/util/Base64.java':`package android.util; public class Base64 { public static final int NO_WRAP=2;
 public static String encodeToString(byte[] bytes,int flags){return java.util.Base64.getEncoder().encodeToString(bytes);} }`,
 'android/speech/tts/Voice.java':`package android.speech.tts; import java.util.Locale;
 public class Voice { private final boolean network; private final Locale locale;
 public Voice(String language,boolean network){this.locale=new Locale(language,"ID");this.network=network;}
 public boolean isNetworkConnectionRequired(){return network;} public Locale getLocale(){return locale;} public int getQuality(){return 400;} }`,
 'android/speech/tts/UtteranceProgressListener.java':`package android.speech.tts;
 public abstract class UtteranceProgressListener { public abstract void onStart(String id); public abstract void onDone(String id);
 public abstract void onError(String id); public void onError(String id,int code){} public void onStop(String id,boolean interrupted){} }`,
 'android/speech/tts/TextToSpeech.java':`package android.speech.tts;
 import android.content.Context; import android.os.Bundle; import java.io.*; import java.util.*;
 public class TextToSpeech { public static final int SUCCESS=0,ERROR=-1,QUEUE_FLUSH=0,ERROR_NOT_INSTALLED_YET=-9;
 public interface OnInitListener { void onInit(int code); }
 public static TextToSpeech last; public static boolean networkOnly=false;
 public final OnInitListener init; public UtteranceProgressListener listener; public String id; public File file;
 public boolean shutdown=false; public float pitch,rate; public Voice selected;
 public TextToSpeech(Context c,OnInitListener init){this.init=init;last=this;}
 public String getDefaultEngine(){return "test-offline-engine";}
 public Set<Voice> getVoices(){Set<Voice> v=new HashSet<>();v.add(new Voice("id",true));if(!networkOnly)v.add(new Voice("in",false));return v;}
 public int setVoice(Voice voice){selected=voice;return SUCCESS;} public int setOnUtteranceProgressListener(UtteranceProgressListener l){listener=l;return SUCCESS;}
 public int setPitch(float p){pitch=p;return SUCCESS;} public int setSpeechRate(float r){rate=r;return SUCCESS;}
 public static int getMaxSpeechInputLength(){return 4000;}
 public int speak(CharSequence t,int q,Bundle b,String i){id=i;return SUCCESS;}
 public int synthesizeToFile(CharSequence t,Bundle b,File f,String i){id=i;file=f;return SUCCESS;}
 public int stop(){return SUCCESS;} public void shutdown(){shutdown=true;}
 public void complete(boolean valid)throws IOException {if(file!=null){byte[] b=new byte[64];if(valid){System.arraycopy("RIFF".getBytes(),0,b,0,4);System.arraycopy("WAVE".getBytes(),0,b,8,4);}try(FileOutputStream out=new FileOutputStream(file)){out.write(b);}}listener.onDone(id);}
 }`,
 'com/getcapacitor/JSObject.java':`package com.getcapacitor; public class JSObject extends java.util.HashMap<String,Object> {}`,
 'com/getcapacitor/PluginMethod.java':'package com.getcapacitor; public @interface PluginMethod {}',
 'com/getcapacitor/annotation/CapacitorPlugin.java':'package com.getcapacitor.annotation; public @interface CapacitorPlugin { String name(); }',
 'com/getcapacitor/PluginCall.java':`package com.getcapacitor;
 public class PluginCall { public final JSObject input=new JSObject(); public JSObject value; public String error; public int resolved=0,rejected=0;
 public PluginCall(String text){input.put("text",text);} public String getString(String k,String d){Object v=input.get(k);return v instanceof String?(String)v:d;}
 public Double getDouble(String k){Object v=input.get(k);return v instanceof Number?((Number)v).doubleValue():null;}
 public void resolve(JSObject v){value=v;resolved++;} public void reject(String message,String code){error=code;rejected++;}
 public void reject(String message,String code,JSObject detail){value=detail;error=code;rejected++;} }`,
 'com/getcapacitor/Plugin.java':`package com.getcapacitor; import android.content.Context; import java.util.*;
 public class Plugin { public final List<JSObject> events=new ArrayList<>();public Context getContext(){return new Context();}
 public void load(){} protected void handleOnDestroy(){} protected void notifyListeners(String name,JSObject value){events.add(value);} }`,
 'id/my/aleprinting/humanale/VoiceHarness.java':`package id.my.aleprinting.humanale;
 import android.os.Handler;import android.speech.tts.TextToSpeech;import com.getcapacitor.PluginCall;import java.io.File;
 public class VoiceHarness {
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 static void drain(){Handler.drain();}
 static void waitCall(PluginCall call)throws Exception{for(int n=0;n<100&&call.resolved+call.rejected==0;n++){Thread.sleep(10);drain();}check(call.resolved+call.rejected>0,"async promise settled");}
 public static void main(String[] args)throws Exception{
 HumanALEVoicePlugin plugin=new HumanALEVoicePlugin();plugin.load();drain();TextToSpeech tts=TextToSpeech.last;
 PluginCall beforeInit=new PluginCall("Halo Indonesia");plugin.speak(beforeInit);drain();check(beforeInit.resolved==0,"initialization is async");
 tts.init.onInit(0);drain();check(tts.id!=null,"queued speech starts after init");check(!tts.selected.isNetworkConnectionRequired(),"offline voice only");
 check(Math.abs(tts.pitch-.76)<.01&&Math.abs(tts.rate-.94)<.01,"adult robot parameters");
 tts.listener.onStart(tts.id);drain();check(beforeInit.resolved==0,"start is not completion");tts.complete(true);drain();check(beforeInit.resolved==1,"done settles speak");
 PluginCall first=new PluginCall("pertama"),second=new PluginCall("kedua");plugin.speak(first);drain();String oldId=tts.id;
 plugin.speak(second);drain();check("CANCELLED".equals(first.error),"replacement cancels first promise");tts.listener.onDone(oldId);tts.listener.onError(oldId,-9);drain();check(second.resolved==0,"stale completion ignored");
 PluginCall staleStatus=new PluginCall("");plugin.status(staleStatus);drain();check(Boolean.TRUE.equals(staleStatus.value.get("configured")),"stale errors cannot change current readiness");
 PluginCall stop=new PluginCall("");plugin.stop(stop);drain();check("CANCELLED".equals(second.error)&&stop.resolved==1,"stop cancels current request");
 PluginCall synth=new PluginCall("contoh suara" );plugin.synthesize(synth);drain();File wav=tts.file;check(synth.resolved==0&&wav.exists(),"synthesis waits for done");
 tts.complete(true);waitCall(synth);check(synth.resolved==1&&"audio/wav".equals(synth.value.get("mime")),"WAV bridge result");check(!wav.exists(),"completed tempfile deleted");
 PluginCall bad=new PluginCall("bad wave");plugin.synthesize(bad);drain();File invalid=tts.file;tts.complete(false);waitCall(bad);check("INVALID_AUDIO".equals(bad.error)&&!invalid.exists(),"invalid WAV rejects and cleans up");
 PluginCall canceled=new PluginCall("cancel synth");plugin.synthesize(canceled);drain();File canceledFile=tts.file;plugin.stop(new PluginCall(""));drain();check("CANCELLED".equals(canceled.error)&&!canceledFile.exists(),"canceled synthesis cleans up");
 PluginCall oversized=new PluginCall("x".repeat(2001));plugin.speak(oversized);drain();check("INVALID_TEXT".equals(oversized.error),"text bound enforced");
 plugin.handleOnDestroy();drain();check(tts.shutdown,"destroy releases native TTS");
 TextToSpeech.networkOnly=true;HumanALEVoicePlugin missing=new HumanALEVoicePlugin();missing.load();drain();TextToSpeech.last.init.onInit(0);drain();
 PluginCall status=new PluginCall("");missing.status(status);drain();check(Boolean.FALSE.equals(status.value.get("configured"))&&"missingData".equals(status.value.get("reason")),"network-only voice has explicit missing-data status");
 PluginCall unavailable=new PluginCall("halo");missing.speak(unavailable);drain();check("MISSING_DATA".equals(unavailable.error),"network voice is never silently selected");missing.handleOnDestroy();drain();
 System.out.println("VOICE_RUNTIME_HARNESS_PASS");
 }
 }`
};

test('Android voice settles actual completion, blocks stale calls, rejects invalid audio, and cleans resources',async t=>{
 const root=await mkdtemp(join(tmpdir(),'humanale-native-voice-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const javaBin=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin'):null;
 const javac=javaBin?join(javaBin,process.platform==='win32'?'javac.exe':'javac'):'javac';
 const java=javaBin?join(javaBin,process.platform==='win32'?'java.exe':'java'):'java';
 try{await run(javac,['-version']);}catch(error){if(error.code==='ENOENT'){t.skip('JDK unavailable; Android build job compiles the plugin');return;}throw error;}
 const sources=[];
 for(const [path,source] of Object.entries(doubles)){
  const destination=join(root,path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,source);sources.push(destination);
 }
 const plugin=join(root,'id/my/aleprinting/humanale/HumanALEVoicePlugin.java');
 await writeFile(plugin,(await readFile(new URL('../scripts/android/HumanALEVoicePlugin.java',import.meta.url),'utf8')).replaceAll('__APP_PACKAGE__','id.my.aleprinting.humanale'));
 sources.push(plugin);
 await run(javac,['-encoding','UTF-8','-d',join(root,'classes'),...sources],{maxBuffer:1024*1024});
 const result=await run(java,['-cp',join(root,'classes'),'id.my.aleprinting.humanale.VoiceHarness'],{timeout:15000});
 assert.match(result.stdout,/VOICE_RUNTIME_HARNESS_PASS/);
});
