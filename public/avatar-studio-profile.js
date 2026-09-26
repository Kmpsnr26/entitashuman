export const AVATAR_STUDIO_DEFAULTS=Object.freeze({
 headWidth:1,
 headHeight:1,
 cheekVolume:1,
 jawWidth:1,
 eyeSpacing:1,
 foreheadWidth:1,
 foreheadHeight:1,
 chinLength:1,
 chinWidth:1,
 noseDepth:1,
 mouthWidth:1,
 lipVolume:1,
 earSize:1,
 lightIntensity:1,
 particleScale:1,
 depth:1,
 density:1
});

export const AVATAR_STUDIO_LIMITS=Object.freeze({
 headWidth:Object.freeze([.82,1.18]),
 headHeight:Object.freeze([.86,1.16]),
 cheekVolume:Object.freeze([.75,1.28]),
 jawWidth:Object.freeze([.75,1.24]),
 eyeSpacing:Object.freeze([.82,1.18]),
 foreheadWidth:Object.freeze([.84,1.18]),
 foreheadHeight:Object.freeze([.88,1.14]),
 chinLength:Object.freeze([.82,1.20]),
 chinWidth:Object.freeze([.80,1.20]),
 noseDepth:Object.freeze([.70,1.35]),
 mouthWidth:Object.freeze([.80,1.22]),
 lipVolume:Object.freeze([.65,1.40]),
 earSize:Object.freeze([.75,1.30]),
 lightIntensity:Object.freeze([.70,1.30]),
 particleScale:Object.freeze([.75,1.25]),
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
 const baseX=finite(point.baseX,x0),baseY=finite(point.baseY,y0);
 const feature=typeof point.feature==='string'?point.feature:'';
 const eyeY=finite(anatomy?.EYE_Y,-.067);
 const mouthY=finite(anatomy?.MOUTH_Y,.285);
 const faceWeight=1-smooth(.48,.72,baseY);
 const cheekWeight=gaussian(baseY,.10,.22)*smooth(.035,.30,Math.abs(baseX))*faceWeight;
 const jawWeight=smooth(.16,.48,baseY)*(1-smooth(.60,.77,baseY))*faceWeight;
 const eyeWeight=gaussian(baseY,eyeY,.085)*smooth(.045,.16,Math.abs(baseX))*faceWeight;
 const foreheadWeight=gaussian(baseY,-.34,.22)*(1-smooth(.34,.46,Math.abs(baseX)))*faceWeight;
 const chinWeight=gaussian(baseY,.43,.13)*(1-smooth(.24,.42,Math.abs(baseX)))*faceWeight;
 const noseWeight=gaussian(baseX,0,.075)*gaussian(baseY,.075,.16)*faceWeight;
 const mouthWeight=gaussian(baseY,mouthY,.09)*(1-smooth(.18,.29,Math.abs(baseX)))*faceWeight;
 const lipWeight=feature.startsWith('lip-')?1:0;
 const earWeight=feature==='ear-shell'?1:0;

 let x=x0*p.headWidth;
 x*=1+(p.cheekVolume-1)*cheekWeight;
 x*=1+(p.jawWidth-1)*jawWeight;
 x*=1+(p.eyeSpacing-1)*eyeWeight;
 x*=1+(p.foreheadWidth-1)*foreheadWeight;
 x*=1+(p.chinWidth-1)*chinWeight;
 x*=1+(p.mouthWidth-1)*mouthWeight;

 const verticalOrigin=-.02;
 let y=y0+(y0-verticalOrigin)*(p.headHeight-1)*faceWeight;
 y+=(baseY-eyeY)*(p.foreheadHeight-1)*.34*foreheadWeight;
 y+=(p.chinLength-1)*.13*chinWeight;

 let z=z0*p.depth+(p.cheekVolume-1)*.04*cheekWeight;
 z+=(p.noseDepth-1)*.14*noseWeight;
 z+=(p.lipVolume-1)*.025*lipWeight;

 if(earWeight){
  const side=finite(point.earSide,Math.sign(baseX)||1);
  const anchorX=side*.405,anchorY=.015;
  x=anchorX+(x-anchorX)*p.earSize;
  y=anchorY+(y-anchorY)*p.earSize;
  z*=.92+.08*p.earSize;
 }

 return {
  x:Number.isFinite(x)?x:x0,
  y:Number.isFinite(y)?y:y0,
  z:Number.isFinite(z)?z:z0
 };
}
