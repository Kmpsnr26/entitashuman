import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('creator boundary keeps NARA workflow control out of HumanALE renderer and preload until final integration',async()=>{
 const [preload,app,visualStudio,main]=await Promise.all([
  readFile(new URL('desktop/preload.cjs',root),'utf8'),
  readFile(new URL('public/app.js',root),'utf8'),
  readFile(new URL('public/humanale-visual-studio.js',root),'utf8'),
  readFile(new URL('desktop/main.cjs',root),'utf8')
 ]);
 for(const source of [preload,app,visualStudio]){
  assert.doesNotMatch(source,/createWorkflow|startWorkflowStep|grantWorkflowPermissions|recoverWorkflowStep|workflowSnapshot|workflowQueue|workflowReport|authoritySnapshot|advanceAuthorityPhase|evaluateBridge|integrationReadiness|integrationCertificate|humanaleIntegrationContract|evaluateHumanALEIntegrationRequest|nara-humanale\/1/);
 }
 assert.doesNotMatch(preload,/dudidam:nara-workflow/);
 assert.doesNotMatch(preload,/dudidam:nara-authority/);
 assert.doesNotMatch(main,/ipcMain\.handle\(['"]dudidam:nara-workflow/);
 assert.doesNotMatch(main,/ipcMain\.handle\(['"]dudidam:nara-authority/);
 assert.doesNotMatch(main,/ipcMain\.handle\(['"]dudidam:nara-readiness/);
 assert.doesNotMatch(preload,/dudidam:nara-readiness/);
 assert.doesNotMatch(preload,/dudidam:nara-humanale/);
 assert.doesNotMatch(main,/ipcMain\.handle\(['"]dudidam:nara-humanale/);
});

test('NARA workflow implementation remains inside NARA Core',async()=>{
 const [orchestrator,engine,index]=await Promise.all([
  readFile(new URL('nara-core/brain/orchestrator.js',root),'utf8'),
  readFile(new URL('nara-core/brain/workflow-engine.js',root),'utf8'),
  readFile(new URL('nara-core/brain/index.js',root),'utf8')
 ]);
 assert.match(orchestrator,/this\.workflow=createWorkflowEngine\(\{bus:this\.bus\}\)/);
 assert.match(orchestrator,/createWorkflow\(plan/);
 assert.match(orchestrator,/workflowSnapshot\(\)/);
 assert.match(orchestrator,/workflowQueue\(\)/);
 assert.match(orchestrator,/workflowReport\(\)/);
 assert.match(engine,/controlledBy:'NARA_CORE'/);
 assert.match(engine,/executionBoundary:'NARA_CORE_ONLY'/);
 assert.match(index,/workflow-engine\.js/);
 assert.match(index,/authority-policy\.js/);
 assert.match(index,/integration-readiness\.js/);
 assert.match(orchestrator,/integrationReadiness\(/);
 assert.match(orchestrator,/integrationCertificate\(/);
 assert.match(orchestrator,/humanaleIntegrationContract\(/);
 assert.match(orchestrator,/evaluateHumanALEIntegrationRequest\(/);
 assert.match(index,/humanale-integration-contract\.js/);
});
