import {cp,mkdir} from 'node:fs/promises';
import path from 'node:path';

const out=path.resolve('public','vendor');
await mkdir(out,{recursive:true});
const assets=[
 ['node_modules/@xterm/xterm/lib/xterm.js','xterm.js'],
 ['node_modules/@xterm/xterm/css/xterm.css','xterm.css'],
 ['node_modules/@xterm/addon-fit/lib/addon-fit.js','addon-fit.js']
];
for(const [source,name] of assets)await cp(path.resolve(source),path.join(out,name));
console.log('Prepared local xterm assets.');
