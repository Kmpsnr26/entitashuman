import {realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

function inside(root,target){
 const path=relative(root,target);
 return path!== '..'&&!path.startsWith('..'+sep)&&!isAbsolute(path);
}

export async function assertPackagedPty(managerUrl){
 const appRoot=await realpath(resolve(dirname(fileURLToPath(managerUrl)),'..'));
 const modules=await realpath(resolve(appRoot,'node_modules'));
 const entry=await realpath(createRequire(managerUrl).resolve('node-pty'));
 if(!inside(appRoot,modules)||!inside(modules,entry))throw new Error('Packaged node-pty must resolve inside this app, not a parent installation.');
 return entry;
}
