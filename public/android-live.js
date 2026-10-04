const ENDPOINT_KEY='humanale.android.live-endpoint.v1';

export function normalizeLiveUrl(value){
  const input=String(value||'').trim();
  if(input.length>2048)throw new Error('Alamat server terlalu panjang.');
  let url;
  try{url=new URL(input);}catch{throw new Error('Masukkan alamat lengkap server, misalnya http://127.0.0.1:4178.');}
  const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  const authority=input.match(/^http:\/\/([^/?#]+)/i)?.[1]||'';
  if(url.protocol==='http:'&&!/^(localhost|127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?$/i.test(authority))throw new Error('Gunakan localhost, 127.0.0.1, atau [::1] dengan port yang valid.');
  if(url.port==='0')throw new Error('Port server tidak valid.');
  if(url.username||url.password||url.search||url.hash)throw new Error('Alamat server tidak boleh berisi password, token, atau parameter login.');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))throw new Error('Server online harus memakai HTTPS. HTTP hanya untuk server lokal di HP ini.');
  if(!url.hostname||url.hostname.endsWith('.'))throw new Error('Nama server tidak valid.');
  return url.href;
}

export function setupAndroidLive({document:doc=document,capacitor=window.Capacitor,storage}={}){
  if(capacitor?.getPlatform?.()!=='android')return false;
  try{storage??=window.localStorage;}catch{}
  const plugin=capacitor.Plugins?.HumanALERuntime;
  const launch=doc.querySelector('#androidLiveOpen'),dialog=doc.querySelector('#androidLiveDialog');
  if(!launch||!dialog)return false;
  launch.hidden=false;
  const form=doc.querySelector('#androidLiveForm'),urlInput=doc.querySelector('#androidLiveUrl'),authInput=doc.querySelector('#androidLiveAuth'),status=doc.querySelector('#androidLiveStatus'),submit=doc.querySelector('#androidLiveConnect');
  let saved;
  try{saved=JSON.parse(storage?.getItem(ENDPOINT_KEY)||'null');}catch{}
  if(saved){try{urlInput.value=normalizeLiveUrl(saved.url);authInput.value=saved.authOrigin?new URL(normalizeLiveUrl(saved.authOrigin)).origin:'';}catch{}}
  launch.addEventListener('click',()=>{
    status.textContent=plugin?'Pilih server yang sedang berjalan.':'APK ini belum memiliki modul NARA Live. Pasang kandidat terbaru.';
    submit.disabled=!plugin;
    dialog.showModal();
  });
  doc.querySelector('#androidLiveClose').addEventListener('click',()=>dialog.close());
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!plugin||submit.disabled)return;
    submit.disabled=true;
    status.textContent='Membuka runtime…';
    try{
      const url=normalizeLiveUrl(urlInput.value);
      const authOrigin=authInput.value.trim()?new URL(normalizeLiveUrl(authInput.value)).origin:'';
      const result=await plugin.open({url,...(authOrigin?{authOrigin}:{})});
      if(!result?.opened)throw new Error('Halaman runtime belum dapat dibuka.');
      try{storage?.setItem(ENDPOINT_KEY,JSON.stringify({url,authOrigin}));}catch{}
      status.textContent='Halaman runtime dibuka. Login dan status live diperiksa di server.';
    }catch(error){status.textContent=error?.message||'Runtime belum dapat dibuka. Periksa alamat server.';}
    finally{submit.disabled=false;}
  });
  return true;
}
