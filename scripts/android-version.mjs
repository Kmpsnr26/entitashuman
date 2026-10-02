export function androidVersionFromPackageVersion(value){
 const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(String(value||'').trim());
 if(!match)throw new Error('Versi Android harus memakai semver numerik major.minor.patch.');
 const [,majorText,minorText,patchText]=match;
 const major=Number(majorText),minor=Number(minorText),patch=Number(patchText);
 if(minor>999||patch>999)throw new Error('Minor dan patch Android harus berada pada rentang 0–999.');
 const versionCode=major*1_000_000+minor*1_000+patch;
 if(!Number.isSafeInteger(versionCode)||versionCode<1||versionCode>2_100_000_000)throw new Error('Versi Android menghasilkan versionCode di luar rentang yang didukung.');
 return {versionName:`${major}.${minor}.${patch}`,versionCode};
}
