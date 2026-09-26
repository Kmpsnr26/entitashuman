export const AVATAR_STUDIO_DEFAULTS=Object.freeze({
 headWidth:1,
 headHeight:1,
 cheekVolume:1,
 jawWidth:1,
 eyeSpacing:1,
 depth:1,
 density:1
});

export const AVATAR_STUDIO_LIMITS=Object.freeze({
 headWidth:Object.freeze([.82,1.18]),
 headHeight:Object.freeze([.86,1.16]),
 cheekVolume:Object.freeze([.75,1.28]),
 jawWidth:Object.freeze([.75,1.24]),
 eyeSpacing:Object.freeze([.82,1.18]),
 depth:Object.freeze([.75,1.30]),
 density:Object.freeze([.35,1])
});

const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const smooth=(a,b,value)=>{const t=clamp((value-a)/(b-a),0,1);return t*t*(3-2*t);};
const gaussian=(value,center,radius)=>Math.exp(-(((value-center)/radius)**2));

export function normalizeAvatarStudioProfile(value={}){
 const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const normalized={};
 for(const [key,fallback] of Object.entries(AVATAR_STUDIO_DEFAULTS)){
  const [min,max]=AVATAR_STUDIO_LIMITS[key];
  normalized[key]=clamp(finite(source[key],fallback),min,max);
 }
 return Object.freeze(normalized);
}

export function transformAvatarStudioPoint(point={},profile={},anatomy={}){
 const p=normalizeAvatarStudioProfile(profile);
 const x0=finite(point.x,0),y0=finite(point.y,0),z0=finite(point.z,0);
 const eyeY=finite(anatomy?.EYE_Y,-.067);
 const faceWeight=1-smooth(.48,.72,y0);
 const cheekWeight=gaussian(y0,.10,.22)*smooth(.035,.30,Math.abs(x0))*faceWeight;
 const jawWeight=smooth(.16,.48,y0)*(1-smooth(.60,.77,y0))*faceWeight;
 const eyeWeight=gaussian(y0,eyeY,.085)*smooth(.045,.16,Math.abs(x0))*faceWeight;

 let x=x0*p.headWidth;
 x*=1+(p.cheekVolume-1)*cheekWeight;
 x*=1+(p.jawWidth-1)*jawWeight;
 x*=1+(p.eyeSpacing-1)*eyeWeight;

 const verticalOrigin=-.02;
 const y=y0+(y0-verticalOrigin)*(p.headHeight-1)*faceWeight;
 const z=z0*p.depth+(p.cheekVolume-1)*.04*cheekWeight;

 return {
  x:Number.isFinite(x)?x:x0,
  y:Number.isFinite(y)?y:y0,
  z:Number.isFinite(z)?z:z0
 };
}
