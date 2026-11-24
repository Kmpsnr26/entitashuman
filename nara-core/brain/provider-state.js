const MODES=Object.freeze({
  'alecore-local':'alecore-local',
  chatgpt:'chatgpt-login',copilot:'copilot-cli',codex:'codex-cli',
  openai:'openai-api',gemini:'gemini-api',grok:'grok-api',
  claude:'claude-api',deepseek:'deepseek-api',askcodi:'askcodi-api'
});
const STATUS_ERRORS=new Set(['STATUS_FAILED','STATUS_TIMEOUT','BRIDGE_MISSING']);
const EVIDENCE=new Set(['login-status','successful-request']);

// Public metadata contains only fixed modes/codes and boolean observations.
// Never retain provider payloads, models, error messages or credential values.
export function normalizeProviderStatus(raw={}){
  const id=String(raw?.id||'');
  if(!Object.hasOwn(MODES,id))return null;
  const attached=raw.attached===true;
  const configured=raw.configured===true;
  const busy=raw.busy===true;
  const statusError=STATUS_ERRORS.has(raw.statusError)?raw.statusError:'';
  const evidence=EVIDENCE.has(raw.evidence)?raw.evidence:'none';
  const loginEvidence=['chatgpt','codex'].includes(id)&&evidence==='login-status';
  const verified=attached&&configured&&!statusError&&raw.verified===true&&
    (loginEvidence||evidence==='successful-request');
  return Object.freeze({
    id,attached,configured,busy,verified,
    ready:verified&&!busy,
    auth:verified?'verified':statusError?'unknown':configured?'unverified':'missing',
    mode:MODES[id],
    evidence:verified?evidence:configured?'configuration':'none',
    statusError
  });
}

export function normalizeStartupConnections(raw={}){
  const authenticatedExecutors=Array.isArray(raw.authenticatedExecutors)
    ?[...new Set(raw.authenticatedExecutors.filter(id=>['codex','github-copilot'].includes(id)))]:[];
  return Object.freeze({
    pending:raw.pending===true,
    checkedAt:Number.isFinite(raw.checkedAt)&&raw.checkedAt>=0?raw.checkedAt:0,
    projectRootReady:raw.projectRootReady===true,
    authenticatedExecutors:Object.freeze(authenticatedExecutors),
    mode:'manual',armed:false,realtime:false
  });
}
