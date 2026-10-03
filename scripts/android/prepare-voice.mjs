import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';

export async function prepareAndroidVoice(root='.'){
  const config=JSON.parse(await readFile(join(root,'capacitor.config.json'),'utf8'));
  if(!/^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)+$/.test(config.appId))throw new Error('Invalid Android application package.');
  const packagePath=join(root,'android/app/src/main/java',...config.appId.split('.'));
  const activityPath=join(packagePath,'MainActivity.java');
  let activity=await readFile(activityPath,'utf8');
  if(!activity.includes('registerPlugin(HumanALEVoicePlugin.class)')){
    if(!activity.includes('import android.os.Bundle;'))activity=activity.replace(/(package\s+[\w.]+;)/,'$1\n\nimport android.os.Bundle;');
    if(/\bonCreate\s*\(/.test(activity)){
      if(!/super\.onCreate\([^)]*\);/.test(activity))throw new Error('MainActivity onCreate has no supported super call.');
      activity=activity.replace(/(super\.onCreate\([^)]*\);)/,'registerPlugin(HumanALEVoicePlugin.class);\n        $1');
    }else{
      if(!/extends\s+BridgeActivity\s*\{/.test(activity))throw new Error('Unsupported generated MainActivity.');
      activity=activity.replace(/(extends\s+BridgeActivity\s*\{)/,'$1\n    @Override public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(HumanALEVoicePlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n');
    }
  }
  const template=await readFile(new URL('./HumanALEVoicePlugin.java',import.meta.url),'utf8');
  await mkdir(packagePath,{recursive:true});
  await writeFile(join(packagePath,'HumanALEVoicePlugin.java'),template.replaceAll('__APP_PACKAGE__',config.appId));
  await writeFile(activityPath,activity);
}
