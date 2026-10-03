function actorId(value){
 if((typeof value!=='string'&&typeof value!=='number')||!String(value).trim()||String(value).length>128){
  throw new Error('Identitas peminta suara tidak valid.');
 }
 return String(value).trim();
}

function superseded(){
 const error=new Error('Permintaan suara digantikan oleh permintaan terbaru.');
 error.code='TTS_REQUEST_SUPERSEDED';
 return error;
}

export function createVoiceRequestCoordinator(tts){
 if(typeof tts?.synthesize!=='function'||typeof tts?.stop!=='function')throw new TypeError('Layanan suara tidak valid.');
 let mutations=Promise.resolve(),active=null,revision=0;
 function enqueue(mutation){
  const result=mutations.then(mutation);
  mutations=result.then(()=>{},()=>{});
  return result;
 }
 async function settle(record){
  await tts.stop();
  // stop's service cleanup and the request's own completion must both settle.
  await record.promise.catch(()=>{});
  if(active===record)active=null;
 }
 function synthesize(actor,value){
  let id;
  try{id=actorId(actor);}catch(error){return Promise.reject(error);}
  const requestedRevision=++revision;
  const holder=enqueue(async()=>{
   if(requestedRevision!==revision)throw superseded();
   if(active)await settle(active);
   if(requestedRevision!==revision)throw superseded();
   const record={actor:id,revision:requestedRevision,promise:null};
   active=record;
   // Return a holder from the mutation: awaiting all synthesis here would keep
   // cancellation behind the operation it needs to cancel.
   record.promise=Promise.resolve().then(()=>tts.synthesize(value)).then(
    result=>{if(active===record)active=null;return result;},
    error=>{if(active===record)active=null;throw error;}
   );
   record.promise.catch(()=>{});
   return {promise:record.promise};
  });
  const response=holder.then(result=>result.promise);
  response.catch(()=>{});
  return response;
 }
 function stop(actor){
  let id;
  try{id=actorId(actor);}catch(error){return Promise.reject(error);}
  return enqueue(async()=>{
   const record=active;
   if(!record||record.actor!==id)return {stopped:false};
   await settle(record);
   return {stopped:true};
  });
 }
 return Object.freeze({synthesize,stop});
}
