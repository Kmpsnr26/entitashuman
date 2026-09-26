import {createEventBus} from './event-bus.js';
import {createBrainState} from './brain-state.js';
import {isRegionId} from './regions.js';
import {createSkillSnapshot} from './skill-registry.js';
import {createWorkflowEngine} from './workflow-engine.js';
import {createAuthorityPolicy} from './authority-policy.js';

const connectionEvents=Object.freeze({
  GITHUB:['github.connected','github.disconnected'],
  COPILOT:['copilot.connected','copilot.disconnected'],
  DRIVE:['drive.connected','drive.disconnected'],
  OWNER_EMAIL:['email.connected','email.disconnected'],
  WEB:['web.connected','web.disconnected'],
  TEAM:['team.connected','team.disconnected']
});

export class NaraOrchestrator{
  constructor({bus=createEventBus(),state=createBrainState()}={}){
    this.bus=bus;
    this.state=state;
    this.running=false;
    this.unsubscribe=null;
    this.workflow=createWorkflowEngine({bus:this.bus});
    this.authority=createAuthorityPolicy();
  }

  start(){
    if(this.running)return this.snapshot();
    this.unsubscribe=this.bus.onAny(envelope=>this.state.applyEvent(envelope));
    this.running=true;
    this.bus.emit('nara.start',{source:'orchestrator'});
    return this.snapshot();
  }

  stop(){
    if(!this.running)return this.snapshot();
    this.bus.emit('nara.shutdown',{source:'orchestrator'});
    this.unsubscribe?.();this.unsubscribe=null;this.running=false;
    return this.snapshot();
  }

  dispatch(event,payload={},meta={}){
    if(!this.running)throw new Error('NARA Orchestrator belum dijalankan.');
    const envelope=this.bus.emit(event,payload,meta);
    return {event:envelope,state:this.snapshot()};
  }

  selectRegion(region){
    if(!isRegionId(region))throw new Error('Region NARA tidak dikenal: '+region);
    return this.dispatch('brain.region.select',{region});
  }

  startWork({id='',label='Pekerjaan NARA'}={}){
    return this.dispatch('work.start',{id,label});
  }

  completeWork(payload={}){
    return this.dispatch('work.complete',payload);
  }

  connection(name,connected=true){
    const region=String(name||'').toUpperCase();
    const events=connectionEvents[region];
    if(!events)throw new Error('Koneksi NARA tidak dikenal: '+region);
    return this.dispatch(connected?events[0]:events[1],{region});
  }

  skillSnapshot(agents=[]){
    return createSkillSnapshot({brainState:this.snapshot(),agents});
  }

  createWorkflow(plan,{agents=[]}={}){
    return this.workflow.create(plan,this.skillSnapshot(agents));
  }

  startWorkflow({agents=[]}={}){
    return this.workflow.start(this.skillSnapshot(agents));
  }

  grantWorkflowPermissions(permissions,{agents=[]}={}){
    return this.workflow.grantPermissions(permissions,this.skillSnapshot(agents));
  }

  revokeWorkflowPermissions(permissions,{agents=[]}={}){
    return this.workflow.revokePermissions(permissions,this.skillSnapshot(agents));
  }

  refreshWorkflow({agents=[]}={}){
    return this.workflow.refresh(this.skillSnapshot(agents));
  }

  nextWorkflowStep(){
    return this.workflow.nextReady();
  }

  startWorkflowStep(id,{agents=[]}={}){
    return this.workflow.startStep(id,this.skillSnapshot(agents));
  }

  completeWorkflowStep(id,result=''){
    return this.workflow.completeStep(id,result);
  }

  verifyWorkflowStep(id,verification,{agents=[]}={}){
    return this.workflow.verifyStep(id,verification,this.skillSnapshot(agents));
  }

  failWorkflowStep(id,reason){
    return this.workflow.failStep(id,reason);
  }

  recoverWorkflowStep(id,{agents=[]}={}){
    this.workflow.recoverStep(id,this.skillSnapshot(agents));
    return this.workflow.refresh(this.skillSnapshot(agents));
  }

  cancelWorkflow(reason){
    return this.workflow.cancel(reason);
  }

  workflowSnapshot(){
    return this.workflow.snapshot();
  }

  workflowQueue(){
    return this.workflow.queue();
  }

  workflowReport(){
    return this.workflow.report();
  }

  authoritySnapshot(){
    return this.authority.snapshot();
  }

  advanceAuthorityPhase(next,options={}){
    return this.authority.advancePhase(next,options);
  }

  snapshot(){return this.state.snapshot();}
}

export function createOrchestrator(options){return new NaraOrchestrator(options);}
