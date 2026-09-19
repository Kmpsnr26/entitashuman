package com.alestudio.aleprivateai;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private WebView webView;

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

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
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
canvas{width:min(88vw,420px);height:auto;filter:drop-shadow(0 0 14px #55ff8866)}
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
let mic=null,cam=null,ctx=null,an=null,audio=0,speaking=false,privacy=false,blink=0,nextBlink=performance.now()+1800;
function status(t){q('#status').textContent=t}
function stopMic(){if(mic)mic.getTracks().forEach(t=>t.stop());mic=null;if(ctx)ctx.close();ctx=null;an=null;audio=0;q('#mic').classList.remove('active')}
function stopCam(){if(cam)cam.getTracks().forEach(t=>t.stop());cam=null;q('#cam').classList.remove('active')}
q('#mic').onclick=async()=>{if(privacy)return;if(mic){stopMic();status('Microphone off');return}try{mic=await navigator.mediaDevices.getUserMedia({audio:true});ctx=new AudioContext();let src=ctx.createMediaStreamSource(mic);an=ctx.createAnalyser();src.connect(an);q('#mic').classList.add('active');status('Listening')}catch(e){q('#log').textContent='Mic error: '+e.message}}
q('#cam').onclick=async()=>{if(privacy)return;if(cam){stopCam();status('Camera off');return}try{cam=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}});q('#cam').classList.add('active');status('Camera active')}catch(e){q('#log').textContent='Camera error: '+e.message}}
q('#speak').onclick=()=>{speaking=!speaking;q('#speak').classList.toggle('active',speaking);status(speaking?'Speaking':'Ready')}
q('#privacy').onclick=()=>{privacy=!privacy;document.body.classList.toggle('private',privacy);q('#privacy').classList.toggle('active',privacy);if(privacy){stopMic();stopCam();speaking=false;status('Privacy mode')}else status('Ready')}
async function send(){let m=q('#msg').value.trim();if(!m)return;q('#log').textContent='You: '+m+'\nALE: thinking...';status('Thinking');try{let r=await fetch(q('#endpoint').value,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:m})});if(!r.ok)throw Error('HTTP '+r.status);let d=await r.json();let a=String(d.reply??d.message??JSON.stringify(d));q('#log').textContent='You: '+m+'\nALE: '+a;status('Ready')}catch(e){q('#log').textContent='You: '+m+'\nALE: UI lokal aktif. Backend AI belum tersedia.\n['+e.message+']';status('Local mode')}q('#msg').value=''}
q('#send').onclick=send;q('#msg').addEventListener('keydown',e=>{if(e.key==='Enter')send()})
function draw(t){if(an){let d=new Uint8Array(an.frequencyBinCount);an.getByteFrequencyData(d);audio=d.reduce((a,b)=>a+b,0)/d.length/100}else audio=speaking?.55+.25*Math.sin(t*.02):0;if(t>nextBlink){blink=1;setTimeout(()=>blink=0,150);nextBlink=t+2200+Math.random()*3500}
x.clearRect(0,0,520,520);x.save();x.translate(260,260);x.strokeStyle='#69ff9a';x.shadowColor='#69ff9a';x.shadowBlur=18;x.lineWidth=3;x.beginPath();x.ellipse(0,0,150,205,0,0,Math.PI*2);x.stroke();for(let i=0;i<900;i++){let px=(Math.random()-.5)*290,py=(Math.random()-.5)*390;if(px*px/(150*150)+py*py/(205*205)<1){x.fillStyle='rgba(105,255,154,'+(.16+Math.random()*.5)+')';x.font='10px monospace';x.fillText(Math.random()>.5?'1':'0',px,py)}}let open=blink?1:14;x.fillStyle='#eaffef';[-58,58].forEach(ex=>{x.beginPath();x.ellipse(ex,-30,36,open,0,0,Math.PI*2);x.fill();if(open>3){x.fillStyle='#69ff9a';x.beginPath();x.arc(ex,-30,9,0,Math.PI*2);x.fill();x.fillStyle='#eaffef'}});x.strokeStyle='#69ff9a';x.beginPath();x.ellipse(0,92,44,Math.max(3,8+audio*24),0,0,Math.PI*2);x.stroke();x.restore();requestAnimationFrame(draw)}
requestAnimationFrame(draw);
</script>
</body>
</html>
""";
}
