export const NARA_VOICE_PROFILE=Object.freeze({
  id:'adult-robot-id',
  language:'id-ID',
  style:'adult-robot',
  tone:'tenang',
  pitch:'rendah',
  speed:'sedang',
  effect:'digital-robotic',
  maxQueue:6
});

export function voiceProfile(){return {...NARA_VOICE_PROFILE};}
