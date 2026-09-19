package com.alestudio.aleprivateai;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private WebView webView;
    private TextToSpeech tts;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(3, 8, 6));
        getWindow().setNavigationBarColor(Color.rgb(3, 8, 6));

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClient());
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                tts.setLanguage(new Locale("id", "ID"));
                tts.setSpeechRate(1.0f);
                tts.setPitch(1.0f);
            }
        });
        webView.addJavascriptInterface(new AndroidBridge(), "ALEAndroid");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    List<String> allowed = new ArrayList<>();
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)
                                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                            allowed.add(r);
                        }
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)
                                && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            allowed.add(r);
                        }
                    }
                    if (allowed.isEmpty()) request.deny();
                    else request.grant(allowed.toArray(new String[0]));
                });
            }
        });

        requestMediaPermissions();
        webView.loadDataWithBaseURL(
            "https://ale.local/",
            HTML,
            "text/html",
            "UTF-8",
            null
        );
    }

    private void requestMediaPermissions() {
        List<String> missing = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.CAMERA);
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.RECORD_AUDIO);
        }
        if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), 42);
    }

    private class AndroidBridge {
        @JavascriptInterface
        public void speak(String text) {
            runOnUiThread(() -> {
                if (tts != null && text != null && !text.trim().isEmpty()) {
                    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "ale_reply");
                }
            });
        }

        @JavascriptInterface
        public String deviceStatus() {
            return "android-bridge-ready";
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        super.onDestroy();
    }

    private static final String HTML = """
<!doctype html>
<html lang='id'>
<head>
<meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'>
<title>ALE Private AI</title>
<style>
:root{--a:#69ff9a;--bg:#030806}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% 20%,#082615 0,#030806 50%,#010302 100%);color:#eaffef;font-family:system-ui,Arial;min-height:100vh}
header{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #194c2b;background:#06100bcc;position:sticky;top:0;z-index:3}
h1{font-size:15px;margin:0;color:var(--a);letter-spacing:.8px}.status{font-size:12px;opacity:.75}
main{padding:14px;max-width:760px;margin:auto}
.card{background:#06110bd9;border:1px solid #1f5a35;border-radius:22px;padding:16px;box-shadow:0 0 28px #0aff6a18;margin-bottom:14px}
.face{position:relative;display:grid;place-items:center;min-height:300px;overflow:hidden}
canvas{width:min(88vw,420px);height:auto;filter:drop-shadow(0 0 14px #55ff8866);transform-origin:center;will-change:transform}
.row{display:flex;gap:9px;flex-wrap:wrap}.row>*{flex:1}
button,input{border-radius:14px;border:1px solid #2c6e42;background:#07140c;color:#eaffef;padding:12px;font-size:14px}
button{min-width:110px}.active{background:#124e29;border-color:var(--a);box-shadow:0 0 15px #4cff7a44}
input{width:100%;margin-top:8px}
pre{white-space:pre-wrap;background:#020604;border:1px solid #143c22;border-radius:14px;padding:12px;min-height:90px;font-family:ui-monospace,monospace;font-size:12px}
.note{font-size:11px;opacity:.7;line-height:1.5;margin-top:10px}
.private canvas{opacity:.18}.private .face:after{content:'PRIVACY MODE';position:absolute;color:#fff;font-weight:700;letter-spacing:2px}
</style>
</head>
<body>
<header><div><h1>ALE • PRIVATE AI HUMAN</h1><div id='status' class='status'>Ready • Android APK</div></div><button id='privacy'>Privacy</button></header>
<main>
<section class='card face' id='faceBox'><canvas id='c' width='520' height='520'></canvas></section>
<section class='card'>
<div class='row'>
<button id='mic'>🎙️ Mikrofon</button>
<button id='cam'>📷 Kamera</button>
<button id='speak'>💬 Speak</button>
</div>
<div class='note'>Privacy Mode mematikan mikrofon dan kamera. ALE UI dapat berjalan lokal; jawaban AI penuh memerlukan endpoint HTTPS privat.</div>
</section>
<section class='card'>
<label>Private AI endpoint</label>
<input id='endpoint' value='https://kirim-cetak-dokumen.sitihasnah109.chatgpt.site/api/chat' autocomplete='off'>
<input id='msg' placeholder='Ketik pesan ke ALE...' autocomplete='off'>
<button id='send' style='width:100%;margin-top:8px'>Kirim</button>
<pre id='log'>ALE ready.</pre>
</section>
</main>
<script>
const q=s=>document.querySelector(s),c=q('#c'),x=c.getContext('2d');
let mic=null,cam=null,ctx=null,an=null,audio=0,speaking=false,privacy=false,blink=0,nextBlink=performance.now()+1400,replyPulse=0;
function status(t){q('#status').textContent=t}
function stopMic(){if(mic)mic.getTracks().forEach(t=>t.stop());mic=null;if(ctx)ctx.close();ctx=null;an=null;audio=0;q('#mic').classList.remove('active')}
function stopCam(){if(cam)cam.getTracks().forEach(t=>t.stop());cam=null;q('#cam').classList.remove('active')}
q('#mic').onclick=async()=>{if(privacy)return;if(mic){stopMic();status('Microphone off');return}try{mic=await navigator.mediaDevices.getUserMedia({audio:true});ctx=new AudioContext();let src=ctx.createMediaStreamSource(mic);an=ctx.createAnalyser();src.connect(an);q('#mic').classList.add('active');status('Listening')}catch(e){q('#log').textContent='Mic error: '+e.message}}
q('#cam').onclick=async()=>{if(privacy)return;if(cam){stopCam();status('Camera off');return}try{cam=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}});q('#cam').classList.add('active');status('Camera active')}catch(e){q('#log').textContent='Camera error: '+e.message}}
q('#speak').onclick=()=>{speaking=!speaking;q('#speak').classList.toggle('active',speaking);status(speaking?'Avatar speaking':'Ready');if(speaking&&window.ALEAndroid){ALEAndroid.speak('Halo, saya ALE. Avatar saya sekarang aktif dan bergerak.')}}
q('#privacy').onclick=()=>{privacy=!privacy;document.body.classList.toggle('private',privacy);q('#privacy').classList.toggle('active',privacy);if(privacy){stopMic();stopCam();speaking=false;status('Privacy mode')}else status('Ready')}
function localReply(m){let z=m.toLowerCase();if(z.includes('halo')||z.includes('hai'))return 'Halo. Saya ALE dan mode lokal Android sedang aktif.';if(z.includes('siapa kamu'))return 'Saya ALE Private AI Human, asisten yang sedang berjalan di perangkat Android ini.';if(z.includes('tes')||z.includes('test'))return 'Tes berhasil. Antarmuka, avatar, dan suara lokal sedang aktif.';return 'Pesan diterima. Mode lokal berfungsi, tetapi jawaban AI penuh memerlukan endpoint AI yang aktif.';}async function send(){let m=q('#msg').value.trim();if(!m)return;q('#log').textContent='You: '+m+'\nALE: thinking...';status('Thinking');speaking=true;replyPulse=1;let a='';try{let r=await fetch(q('#endpoint').value,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:m})});if(!r.ok)throw Error('HTTP '+r.status);let d=await r.json();a=String(d.reply??d.message??JSON.stringify(d));status('Online response')}catch(e){a=localReply(m);status('Local mode')}q('#log').textContent='You: '+m+'\nALE: '+a;if(window.ALEAndroid&&ALEAndroid.deviceStatus()==='android-bridge-ready')ALEAndroid.speak(a);setTimeout(()=>{speaking=false;replyPulse=0;status('Ready')},Math.max(1800,Math.min(6500,a.length*55)));q('#msg').value=''}
q('#send').onclick=send;q('#msg').addEventListener('keydown',e=>{if(e.key==='Enter')send()})
function draw(t){if(an){let d=new Uint8Array(an.frequencyBinCount);an.getByteFrequencyData(d);audio=d.reduce((a,b)=>a+b,0)/d.length/82}else audio=speaking?.72+.28*Math.sin(t*.022):.10+.05*Math.sin(t*.006);if(t>nextBlink){blink=1;setTimeout(()=>blink=0,120);nextBlink=t+1600+Math.random()*2600}let bob=Math.sin(t*.0022)*7,turn=Math.sin(t*.00135)*0.045,scale=1+Math.sin(t*.0028)*.012+replyPulse*.01;let lookX=Math.sin(t*.0017)*8,lookY=Math.cos(t*.0012)*4;x.clearRect(0,0,520,520);x.save();x.translate(260,260+bob);x.rotate(turn);x.scale(scale,scale);x.strokeStyle='#69ff9a';x.shadowColor='#69ff9a';x.shadowBlur=18+8*Math.sin(t*.003);x.lineWidth=3;x.beginPath();x.ellipse(0,0,150,205,0,0,Math.PI*2);x.stroke();for(let i=0;i<520;i++){let a=i*.61803398875*6.28318+t*.00018,r=15+(i%95)*1.8,px=Math.cos(a)*Math.min(145,r),py=Math.sin(a)*Math.min(198,r*1.28);if(px*px/(150*150)+py*py/(205*205)<1){x.fillStyle='rgba(105,255,154,'+(.10+((i%11)/20))+')';x.font='10px monospace';x.fillText((i+Math.floor(t/180))%2?'1':'0',px,py)}}let open=blink?1:14;x.fillStyle='#eaffef';[-58,58].forEach(ex=>{x.beginPath();x.ellipse(ex,-30,36,open,0,0,Math.PI*2);x.fill();if(open>3){x.fillStyle='#69ff9a';x.beginPath();x.arc(ex+lookX,-30+lookY,9,0,Math.PI*2);x.fill();x.fillStyle='#07110b';x.beginPath();x.arc(ex+lookX,-30+lookY,3,0,Math.PI*2);x.fill();x.fillStyle='#eaffef'}});x.strokeStyle='#69ff9a';x.lineWidth=3;x.beginPath();let mouth=7+audio*30+Math.max(0,Math.sin(t*.011))*3;x.ellipse(0,92,44,mouth,0,0,Math.PI*2);x.stroke();x.restore();c.style.transform='translateY('+Math.sin(t*.0017)*3+'px) scale('+(1+Math.sin(t*.0025)*.008)+')';requestAnimationFrame(draw)}
requestAnimationFrame(draw);
</script>
</body>
</html>
""";
}
