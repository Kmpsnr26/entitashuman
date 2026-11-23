import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);

test('creator boundary keeps AleCore AI workflow control out of HumanALE renderer and preload until final integration',async()=>{
 const [preload,app,visualStudio,main]=await Promise.all([
  readFile(new URL('desktop/preload.cjs',root),'utf8'),
  readFile(new URL('public/app.js',root),'utf8'),
  readFile(new URL('public/humanale-visual-studio.js',root),'utf8'),
  readFile(new URL('desktop/main.cjs',root),'utf8')
 ]);
 for(const source of [preload,app,visualStudio]){
  assert.doesNotMatch(source,/createWorkflow|startWorkflowStep|grantWorkflowPermissions|recoverWorkflowStep|workflowSnapshot|workflowQueue|workflowReport|authoritySnapshot|advanceAuthorityPhase|evaluateBridge|integrationReadiness|integrationCertificate|humanaleIntegrationContract|evaluateHumanALEIntegrationRequest|humanaleIntegrationDryRun|previewHumanALEIntegrationRoute|alecore-ai-humanale\/1/);
 }
 assert.doesNotMatch(preload,/dudidam:alecore-ai-workflow/);
 assert.doesNotMatch(preload,/dudidam:alecore-ai-authority/);
 assert.doesNotMatch(main,/ipcMain\.handle\(['"]dudidam:alecore-ai-workflow/);
 assert.doesNotMatch(main,/ipcMain\.handle\(['"]dudidam:alecore-ai-authority/);
 assert.doesNotMatch(main,/ipcMain\.handle\(['"]dudidam:alecore-ai-readiness/);
 assert.doesNotMatch(preload,/dudidam:alecore-ai-readiness/);
 assert.doesNotMatch(preload,/dudidam:alecore-ai-humanale/);
 assert.doesNotMatch(main,/ipcMain\.handle\(['"]dudidam:alecore-ai-humanale/);
 assert.doesNotMatch(preload,/humanaleIntegrationDryRun|previewHumanALEIntegrationRoute/);
});

test('AleCore AI workflow implementation remains inside AleCore AI',async()=>{
 const [orchestrator,engine,index]=await Promise.all([
  readFile(new URL('ALECORE-AI/brain/orchestrator.js',root),'utf8'),
  readFile(new URL('ALECORE-AI/brain/workflow-engine.js',root),'utf8'),
  readFile(new URL('ALECORE-AI/brain/index.js',root),'utf8')
 ]);
 assert.match(orchestrator,/this\.workflow=createWorkflowEngine\(\{bus:this\.bus\}\)/);
 assert.match(orchestrator,/createWorkflow\(plan/);
 assert.match(orchestrator,/workflowSnapshot\(\)/);
 assert.match(orchestrator,/workflowQueue\(\)/);
 assert.match(orchestrator,/workflowReport\(\)/);
 assert.match(engine,/controlledBy:'ALECORE_AI'/);
 assert.match(engine,/executionBoundary:'ALECORE_AI_ONLY'/);
 assert.match(index,/workflow-engine\.js/);
 assert.match(index,/authority-policy\.js/);
 assert.match(index,/integration-readiness\.js/);
 assert.match(orchestrator,/integrationReadiness\(/);
 assert.match(orchestrator,/integrationCertificate\(/);
 assert.match(orchestrator,/humanaleIntegrationContract\(/);
 assert.match(orchestrator,/evaluateHumanALEIntegrationRequest\(/);
 assert.match(index,/humanale-integration-contract\.js/);
 assert.match(index,/humanale-integration-router\.js/);
 assert.match(orchestrator,/humanaleIntegrationDryRun\(/);
 assert.match(orchestrator,/previewHumanALEIntegrationRoute\(/);
});
