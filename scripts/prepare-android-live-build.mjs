import {cp,mkdir,readFile,readdir,writeFile,symlink,stat} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Stage an independently identified test app; never rewrite production config.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.argv[2]||join(root,'../humanale-live-build'));
if(output===root||output.startsWith(root+'/'))throw new Error('Use an empty build directory outside the source checkout.');
try{if((await readdir(output)).length)throw new Error('Build directory must be empty. Existing files are preserved.');}catch(error){if(error.code!=='ENOENT')throw error;}
await stat(join(root,'dist/client/index.html'));
await stat(join(root,'node_modules/@capacitor/cli/bin/capacitor'));
await mkdir(output,{recursive:true});
await cp(join(root,'dist/client'),join(output,'dist/client'),{recursive:true});
await cp(join(root,'scripts'),join(output,'scripts'),{recursive:true});
const config=JSON.parse(await readFile(join(root,'capacitor.live.config.json'),'utf8'));
await writeFile(join(output,'capacitor.config.json'),JSON.stringify(config,null,2)+'\n');
const metadata=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
delete metadata.devDependencies;delete metadata.optionalDependencies;
Object.assign(metadata.dependencies,{'@capacitor/core':'7.6.9','@capacitor/cli':'7.6.9','@capacitor/android':'7.6.9'});
await writeFile(join(output,'package.json'),JSON.stringify(metadata,null,2)+'\n');
await symlink(join(root,'node_modules'),join(output,'node_modules'),'junction');
console.log('HumanALE Live staged at '+output);
