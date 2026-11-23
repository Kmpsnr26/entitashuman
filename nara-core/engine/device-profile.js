const safeText=(value,max=160)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);

/** Current first-party product identity. */
export const ALECORE_AI_IDENTITY=Object.freeze({
  id:'ALECORE_AI',
  name:'AleCore AI',
  role:'owner-assistant',
  identityVersion:2,
  voiceCharacter:'adult-robot-id',
  voicePersistent:true,
  creatorAuthority:'owner-only',
  integrationMode:'permissioned-adaptive',
  selfModification:'code-update-only',
  hiddenAutonomy:false
});

/** @deprecated Use ALECORE_AI_IDENTITY. Kept for persisted consumers during migration. */
export const NARA_IDENTITY=Object.freeze({
  id:'NARA',
  role:'owner-assistant',
  identityVersion:1,
  voiceCharacter:'nara-deep',
  voicePersistent:true,
  creatorAuthority:'owner-only',
  integrationMode:'permissioned-adaptive',
  selfModification:'code-update-only',
  hiddenAutonomy:false
});

export function normalizeDeviceProfile(input={}){
  return Object.freeze({
    platform:safeText(input.platform,40),
    release:safeText(input.release,80),
    arch:safeText(input.arch,40),
    hostname:safeText(input.hostname,120),
    runtime:safeText(input.runtime,80),
    integrationMode:'permissioned-adaptive',
    adapters:Object.freeze(
      Array.isArray(input.adapters)
        ?input.adapters.slice(0,32).map(value=>safeText(value,80)).filter(Boolean)
        :[]
    )
  });
}

export function integrationPlan(profile={}){
  const normalized=normalizeDeviceProfile(profile);
  const adapters=new Set(normalized.adapters);
  const plan=[
    {id:'system.telemetry',enabled:true,permission:'owner'},
    {id:'app.dataflow',enabled:true,permission:'owner'},
    {id:'configured.server',enabled:true,permission:'owner'},
    {id:'audio.input',enabled:adapters.has('microphone'),permission:'os'},
    {id:'camera.input',enabled:adapters.has('camera'),permission:'os'},
    {id:'privileged.os',enabled:adapters.has('admin-elevation'),permission:'owner+os'}
  ];
  return Object.freeze({
    identity:ALECORE_AI_IDENTITY,
    legacyIdentity:NARA_IDENTITY,
    device:normalized,
    plan:Object.freeze(plan.map(item=>Object.freeze(item))),
    forbidden:Object.freeze([
      'credential-bypass',
      'authentication-bypass',
      'root-exploit',
      'arbitrary-network-discovery',
      'hidden-persistence'
    ])
  });
}
