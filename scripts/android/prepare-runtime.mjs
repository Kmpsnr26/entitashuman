import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';

export async function prepareAndroidRuntime(root='.'){
  const config=JSON.parse(await readFile(join(root,'capacitor.config.json'),'utf8'));
  if(!/^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)+$/.test(config.appId))throw new Error('Invalid Android application package.');
  // The native plugin trusts only Capacitor's bundled default origin.
  if(config.server?.url || config.server?.hostname && config.server.hostname!=='localhost' || config.server?.androidScheme && config.server.androidScheme!=='https')
    throw new Error('Android runtime requires the bundled https://localhost Capacitor origin.');
  const sourcePath=join(root,'android/app/src/main');
  const packagePath=join(sourcePath,'java',...config.appId.split('.'));
  const activityPath=join(packagePath,'MainActivity.java');
  let activity=await readFile(activityPath,'utf8');
  if(!activity.includes('registerPlugin(HumanALERuntimePlugin.class)')){
    if(!activity.includes('import android.os.Bundle;'))activity=activity.replace(/(package\s+[\w.]+;)/,'$1\n\nimport android.os.Bundle;');
    if(/\bonCreate\s*\(/.test(activity)){
      if(!/super\.onCreate\([^)]*\);/.test(activity))throw new Error('MainActivity onCreate has no supported super call.');
      activity=activity.replace(/(super\.onCreate\([^)]*\);)/,'registerPlugin(HumanALERuntimePlugin.class);\n        $1');
    }else{
      if(!/extends\s+BridgeActivity\s*\{/.test(activity))throw new Error('Unsupported generated MainActivity.');
      activity=activity.replace(/(extends\s+BridgeActivity\s*\{)/,'$1\n    @Override public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(HumanALERuntimePlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n');
    }
  }
  for(const name of ['HumanALERuntimePlugin','RuntimeActivity','RuntimeUrlPolicy']){
    const template=await readFile(new URL(`./${name}.java`,import.meta.url),'utf8');
    await writeFile(join(packagePath,`${name}.java`),template.replaceAll('__APP_PACKAGE__',config.appId));
  }
  let manifest=await readFile(join(sourcePath,'AndroidManifest.xml'),'utf8');
  manifest=manifest.replace(/<application\b[^>]*>/,tag=>{
    tag=tag.replace(/\s+android:usesCleartextTraffic="[^"]*"/g,'').replace(/\s+android:networkSecurityConfig="[^"]*"/g,'');
    return tag.replace(/>$/,' android:usesCleartextTraffic="false" android:networkSecurityConfig="@xml/humanale_runtime_network_security">');
  });
  if(!manifest.includes('android:name=".RuntimeActivity"'))manifest=manifest.replace('</application>','    <activity android:name=".RuntimeActivity" android:exported="false" />\n    </application>');
  await mkdir(join(sourcePath,'res/xml'),{recursive:true});
  await writeFile(join(sourcePath,'res/xml/humanale_runtime_network_security.xml'),`<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">::1</domain>
  </domain-config>
</network-security-config>
`);
  await writeFile(activityPath,activity);
  await writeFile(join(sourcePath,'AndroidManifest.xml'),manifest);
}
