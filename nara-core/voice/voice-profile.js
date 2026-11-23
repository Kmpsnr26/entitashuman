/** Current first-party voice profile for AleCore AI. */
export const ALECORE_AI_VOICE_PROFILE=Object.freeze({
  id:'adult-robot-id',
  language:'id-ID',
  style:'adult-robot',
  tone:'tenang',
  pitch:'rendah',
  speed:'sedang',
  effect:'digital-robotic',
  maxQueue:6
});

/** @deprecated Use ALECORE_AI_VOICE_PROFILE. */
export const NARA_VOICE_PROFILE=ALECORE_AI_VOICE_PROFILE;

export function alecoreVoiceProfile(){return {...ALECORE_AI_VOICE_PROFILE};}

/** @deprecated Use alecoreVoiceProfile(). */
export const voiceProfile=alecoreVoiceProfile;
