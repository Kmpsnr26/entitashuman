import {NARA_VOICE_PROFILE} from './voice-profile.js';
import {voiceCueForEvent} from './voice-events.js';

export class NaraVoiceFeedback{
  constructor({now=()=>Date.now()}={}){
    this.now=now;
    this.lastByKey=new Map();
    this.sequence=0;
  }

  consume(envelope={}){
    const mapped=voiceCueForEvent(envelope);
    if(!mapped)return null;
    const now=this.now();
    const key=mapped.key||String(envelope.event||'event');
    const previous=this.lastByKey.get(key)||0;
    if(previous&&now-previous<(mapped.cooldownMs||1200))return null;
    this.lastByKey.set(key,now);
    return Object.freeze({
      id:++this.sequence,
      event:String(envelope.event||''),
      key,
      text:String(mapped.text||'').slice(0,240),
      priority:mapped.priority||'normal',
      style:NARA_VOICE_PROFILE.style,
      language:NARA_VOICE_PROFILE.language,
      createdAt:now
    });
  }

  reset(){this.lastByKey.clear();this.sequence=0;}
}

export function createVoiceFeedback(options){return new NaraVoiceFeedback(options);}
