import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'dotenv';

const template=await readFile(new URL('../../.env.staging.example',import.meta.url),'utf8');
const values=parse(template);
const optional=['OPENAI_API_KEY','GEMINI_API_KEY','ANTHROPIC_API_KEY',
  'GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET',
  'GOOGLE_DRIVE_REFRESH_TOKEN','GOOGLE_DRIVE_BACKUP_FOLDER_ID'];
for(const key of optional){
  assert.equal(Object.hasOwn(values,key),false,key+' must remain omitted until configured');
  assert.ok(template.includes('# '+key+'='),key+' must remain documented');
  delete process.env[key];
}
for(const key of ['COMPAT_API_BASE_URL','COMPAT_API_KEY','COMPAT_MODEL'])delete process.env[key];
Object.assign(process.env,values,{
  DATABASE_URL:'postgresql://staging_test@127.0.0.1:5432/staging_test',
  AUTH_SESSION_SECRET:'a'.repeat(64),
  NARA_SESSION_SECRET:'b'.repeat(64),
  TICKET_PEPPER:'c'.repeat(64)
});
const {env}=await import('../../src/config/env.ts');
assert.equal(env.NODE_ENV,'production');
for(const key of optional)assert.equal(env[key],undefined);
assert.equal(env.PUBLIC_AUTH_ORIGIN,values.PUBLIC_AUTH_ORIGIN);
console.log('PASS: production staging template parses with required test values and optional providers/Drive omitted');
