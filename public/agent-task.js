export const WORK_AGENT_IDS=Object.freeze(['humanale-orchestrator','github-copilot','codex','cursor','claude']);

export function workReadinessError(status={}){
 if(status?.error)return String(status.error);
 if(status?.workReady===true&&status?.workReadiness?.ready!==false)return '';
 return String(status?.workReadiness?.error||status?.workBlockReason||
  (status?.projectRootReady===false
   ?'Folder proyek belum dipilih atau tidak dapat diakses. Pilih checkout Git melalui Developer agents.'
   :'Kesiapan Mode Kerja belum terverifikasi. Periksa koneksi di Developer agents untuk melihat branch, perubahan lokal, dan batas keamanan.'));
}

export function selectWorkAgent(status={},provider='chatgpt',selectedId=''){
 const blocker=workReadinessError(status);
 if(blocker)throw new Error(blocker);
 const available=new Map((status.agents||[]).filter(agent=>(agent?.canRun===true||agent?.canAttempt===true)&&WORK_AGENT_IDS.includes(agent.id)).map(agent=>[agent.id,agent]));
 const preferred=provider==='copilot'?'github-copilot':provider==='chatgpt'?'humanale-orchestrator':'';
 for(const id of [selectedId,preferred,'humanale-orchestrator',...WORK_AGENT_IDS]){
  if(available.has(id))return available.get(id);
 }
 throw new Error('Tidak ada executor CLI yang siap untuk Mode Kerja. Buka Developer agents, periksa koneksi, lalu login ke executor yang tersedia.');
}

export async function createAgentTaskPayload({id,prompt,mode='analyze',prepareMemory=async()=>null}={}){
 const payload={id,prompt,mode:mode==='work'?'work':'analyze'};
 // Worker memory remains behind the trusted maintenance boundary. Analysis may
 // receive the user-approved context packet; work must not even prepare one.
 if(payload.mode==='analyze')payload.memoryContext=await prepareMemory(prompt,'planner');
 return payload;
}

export function hasAppliedWorkChanges(result={}){
 return !result?.error&&result?.mode==='work'&&Number.isSafeInteger(result?.maintenance?.changedFiles)&&result.maintenance.changedFiles>0;
}
