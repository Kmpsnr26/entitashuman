import {readFile,writeFile} from 'node:fs/promises';
import {androidVersionFromPackageVersion} from './android-version.mjs';

const manifestPath='android/app/src/main/AndroidManifest.xml';
const buildGradlePath='android/app/build.gradle';
let manifest=await readFile(manifestPath,'utf8');
let buildGradle=await readFile(buildGradlePath,'utf8');
const packageJson=JSON.parse(await readFile('package.json','utf8'));
const {versionName,versionCode}=androidVersionFromPackageVersion(packageJson.version);

const permissions=[
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />'
];

for(const permission of permissions){
  if(!manifest.includes(permission)){
    manifest=manifest.replace('<application',permission+'\n    <application');
  }
}

const cameraFeature='<uses-feature android:name="android.hardware.camera.any" android:required="false" />';
if(!manifest.includes(cameraFeature)){
  manifest=manifest.replace('<application',cameraFeature+'\n    <application');
}

manifest=manifest.replace(
  /android:theme="@style\/AppTheme"/,
  'android:theme="@style/AppTheme" android:screenOrientation="unspecified"'
);

if(!/versionCode\s+\d+/.test(buildGradle)||!/versionName\s+["'][^"']+["']/.test(buildGradle)){
  throw new Error('Metadata versi Android tidak ditemukan di android/app/build.gradle.');
}
buildGradle=buildGradle
  .replace(/versionCode\s+\d+/,`versionCode ${versionCode}`)
  .replace(/versionName\s+["'][^"']+["']/,`versionName "${versionName}"`);

await writeFile(manifestPath,manifest);
await writeFile(buildGradlePath,buildGradle);
console.log(`Android project prepared for HumanALE ${versionName} (${versionCode}) with camera/microphone/network access.`);
