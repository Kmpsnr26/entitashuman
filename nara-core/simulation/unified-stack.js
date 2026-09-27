import {randomUUID} from 'node:crypto';
import {createEventBus} from '../brain/event-bus.js';
import {createDecisionEngine} from '../decision/index.js';
import {createMemoryManager} from '../memory/index.js';
import {createSkillExecutor} from '../execution/index.js';
import {createVerificationEngine} from '../verification/index.js';
import {createLearningEngine} from '../learning/index.js';
import {createWorkflowOrchestrator} from '../workflow/index.js';
import {createSupervisor} from '../supervisor/index.js';
import {createApprovalManager} from '../permissions/index.js';
import {
  createNaraHumanALEBridge,
  createMockHumanALE
} from '../integration/index.js';

export const NARA_UNIFIED_SIMULATION_VERSION='1.0.0';
export const NARA_UNIFIED_SIMULATION_MODE='SIMULATION_ONLY';
export const NARA_UNIFIED_SIMULATION_SCOPE='session.unified-simulation';

export const NARA_UNIFIED_COMPONENTS=Object.freeze([
  'decision',
  'memory',
  'execution',
  'verification',
  'learning',
  'workflow',
  'approval',
  'integration'
]);

const freeze=value=>Object.freeze(value);

function supervisorBlocked(gate){
  return freeze({
    version:NARA_UNIFIED_SIMULATION_VERSION,
    mode:NARA_UNIFIED_SIMULATION_MODE,
    status:'BLOCKED',
    reason:'SUPERVISOR_'+String(gate.componentId||'UNKNOWN').toUpperCase()+'_'+String(gate.reason||'blocked').toUpperCase(),
    componentId:gate.componentId||null,
    retryAt:gate.retryAt??null,
    realExecution:false
  });
}

function approvalBlocked(reason){
  return freeze({
    version:NARA_UNIFIED_SIMULATION_VERSION,
    mode:NARA_UNIFIED_SIMULATION_MODE,
    status:'APPROVAL_REQUIRED',
    reason:String(reason||'approval_required'),
    realExecution:false
  });
}

export function createNaraUnifiedSimulationStack({
  now=()=>Date.now(),
  idFactory=()=>randomUUID(),
  mockHumanALEOptions={}
}={}){
  const bus=createEventBus({historyLimit:500});
  const decisionEngine=createDecisionEngine({bus,now,idFactory});
  const memoryManager=createMemoryManager({bus,now,idFactory});
  const skillExecutor=createSkillExecutor({bus,now,idFactory});
  const verificationEngine=createVerificationEngine({bus,now,idFactory});
  const learningEngine=createLearningEngine({bus,now,idFactory});
  const approvalManager=createApprovalManager({bus,now,idFactory});
  const supervisor=createSupervisor({bus,now});

  const mockHumanALE=createMockHumanALE({
    ...mockHumanALEOptions,
    now
  });
  const bridge=createNaraHumanALEBridge({
    transport:mockHumanALE,
    now,
    idFactory,
    maxRetries:2,
    maxQueue:32,
    historyLimit:100
  });

  for(const componentId of NARA_UNIFIED_COMPONENTS){
    supervisor.register({
      id:componentId,
      critical:true,
      allowDegraded:false,
      errorThreshold:1,
      heartbeatTimeoutMs:10*60*1000,
      cooldownMs:60*1000
    });
    supervisor.report({
      componentId,
      status:'healthy',
      timestamp:now()
    });
  }

  memoryManager.write({
    id:'simulation.mode',
    kind:'working',
    source:'unified-simulation',
    sensitivity:'normal',
    priority:1,
    pinned:true,
    tags:['simulation'],
    value:{
      mode:NARA_UNIFIED_SIMULATION_MODE,
      realHumanALE:false,
      finalIntegrationUnlocked:false
    }
  });

  skillExecutor.register({
    id:'reason',
    description:'Safe unified-stack reasoning simulation handler.',
    handler:async input=>freeze({
      simulated:true,
      realExecution:false,
      kind:'reason',
      requestPresent:Boolean(input?.request),
      contextItemCount:Array.isArray(input?.context?.items)?input.context.items.length:0
    })
  });

  skillExecutor.register({
    id:'humanale.command',
    description:'Mock-only HumanALE command simulation. No real transport is exposed.',
    handler:async()=> {
      const message=bridge.enqueue('system.ping',{
        mode:NARA_UNIFIED_SIMULATION_MODE,
        realExecution:false
      });
      const delivery=await bridge.flush({limit:1});
      return freeze({
        simulated:true,
        realExecution:false,
        target:'mock-humanale',
        delivered:delivery.delivered===1,
        messageId:message.id
      });
    }
  });

  verificationEngine.register({
    id:'simulation-output',
    description:'Verifies the result stayed simulation-only.',
    handler:artifact=>freeze({
      ok:Boolean(
        artifact&&
        artifact.simulated===true&&
        artifact.realExecution===false
      ),
      code:'SIMULATION_ONLY_OUTPUT'
    })
  });

  const workflow=createWorkflowOrchestrator({
    decisionEngine,
    memoryManager,
    skillExecutor,
    verificationEngine,
    learningEngine,
    bus,
    now,
    idFactory
  });

  const initialHealth=mockHumanALE.emit(
    'runtime.health',
    {state:'READY',reason:'simulation-init'},
    {timestamp:now()}
  );
  bridge.receive(initialHealth);

  const baseDecisionContext=({owner=false,finalReady=false}={})=>({
    capabilities:{
      reason:'ready',
      'humanale.command':'ready',
      sync:'ready'
    },
    deniedCapabilities:[],
    dependencies:{},
    gates:{
      'humanale.final_ready':Boolean(finalReady),
      'integration.contract_validated':true
    },
    approvals:{owner:Boolean(owner)}
  });

  const checkHealth=()=>{
    for(const componentId of NARA_UNIFIED_COMPONENTS){
      const gate=supervisor.canRun(componentId,{timestamp:now()});
      if(!gate.allowed)return freeze({componentId,...gate});
    }
    return freeze({allowed:true,reason:'healthy'});
  };

  async function runReasonSimulation({
    workflowId=null,
    requestId=null,
    input={}
  }={}){
    const health=checkHealth();
    if(!health.allowed)return supervisorBlocked(health);
    const wfId=workflowId||('sim-reason-'+idFactory());
    const reqId=requestId||('req-'+idFactory());
    return workflow.run({
      workflowId:wfId,
      requestId:reqId,
      decisionRequest:{
        action:'reason',
        actor:'simulation',
        label:'Unified stack reason simulation'
      },
      decisionContext:baseDecisionContext(),
      contextRequest:{
        target:'reasoner',
        tags:['simulation']
      },
      skillId:'reason',
      input,
      verifierIds:['simulation-output']
    });
  }

  function createMockCommandApproval({
    id=null,
    scope=NARA_UNIFIED_SIMULATION_SCOPE,
    ttlMs
  }={}){
    return approvalManager.create({
      ...(id?{id}:{}),
      capability:'humanale.command',
      scope,
      requestedBy:'unified-simulation',
      ...(ttlMs===undefined?{}:{ttlMs}),
      singleUse:true,
      timestamp:now()
    });
  }

  function decideMockCommandApproval(id,{
    approved,
    authority='owner'
  }={}){
    return approvalManager.decide(id,{
      approved,
      authority,
      timestamp:now()
    });
  }

  async function runMockHumanALESimulation({
    approvalId,
    scope=NARA_UNIFIED_SIMULATION_SCOPE,
    workflowId=null,
    requestId=null
  }={}){
    const health=checkHealth();
    if(!health.allowed)return supervisorBlocked(health);

    const preflight=approvalManager.authorize({
      id:approvalId,
      capability:'humanale.command',
      scope,
      consume:false,
      timestamp:now()
    });
    if(!preflight.allowed)return approvalBlocked(preflight.reason);

    const consumed=approvalManager.authorize({
      id:approvalId,
      capability:'humanale.command',
      scope,
      consume:true,
      timestamp:now()
    });
    if(!consumed.allowed)return approvalBlocked(consumed.reason);

    const wfId=workflowId||('sim-humanale-'+idFactory());
    const reqId=requestId||('req-'+idFactory());
    return workflow.run({
      workflowId:wfId,
      requestId:reqId,
      decisionRequest:{
        action:'external.write',
        actor:'simulation',
        capability:'humanale.command',
        label:'Mock HumanALE command simulation'
      },
      decisionContext:baseDecisionContext({owner:true}),
      contextRequest:{
        target:'humanale-mock',
        tags:['simulation']
      },
      skillId:'humanale.command',
      input:{mode:NARA_UNIFIED_SIMULATION_MODE},
      verifierIds:['simulation-output']
    });
  }

  function evaluateFinalIntegrationBoundary({id=null}={}){
    return decisionEngine.decide({
      id:id||('integration-boundary-'+idFactory()),
      action:'integration.handshake',
      actor:'simulation',
      label:'Real HumanALE integration boundary check'
    },baseDecisionContext({owner:false,finalReady:false}));
  }

  function reportComponentHealth({
    componentId,
    status,
    latencyMs=null,
    errorCode=null
  }={}){
    return supervisor.report({
      componentId,
      status,
      latencyMs,
      errorCode,
      timestamp:now()
    });
  }

  function recoveryRecommendation(componentId){
    return supervisor.recommend(componentId,{timestamp:now()});
  }

  function snapshot(){
    const decision=decisionEngine.snapshot();
    const memory=memoryManager.snapshot();
    const execution=skillExecutor.snapshot();
    const verification=verificationEngine.snapshot();
    const learning=learningEngine.snapshot();
    const workflowSnapshot=workflow.snapshot();
    const approvals=approvalManager.snapshot();
    const supervision=supervisor.snapshot();
    const integration=bridge.snapshot();
    const mock=mockHumanALE.snapshot();

    return freeze({
      version:NARA_UNIFIED_SIMULATION_VERSION,
      mode:NARA_UNIFIED_SIMULATION_MODE,
      mockHumanALE:true,
      realHumanALEBridgeActive:false,
      finalIntegrationUnlocked:false,
      components:freeze(supervision.components.map(item=>freeze({
        id:item.id,
        status:item.status,
        circuit:item.circuit
      }))),
      counters:freeze({
        decision:decision.counters,
        memory:memory.counters,
        execution:execution.counters,
        verification:verification.counters,
        learning:learning.counters,
        workflow:workflowSnapshot.counters,
        approval:approvals.counters,
        supervisor:supervision.counters,
        integration:integration.counters
      }),
      approvalStatusCounts:approvals.statusCounts,
      integration:freeze({
        connectedToMock:integration.connected,
        health:integration.health.state,
        queued:integration.queue.length,
        deadLetters:integration.deadLetters.length,
        acknowledgements:integration.acknowledgements.length,
        inboundAccepted:integration.counters.inboundAccepted
      }),
      mockHumanALEState:freeze({
        online:mock.online,
        health:mock.health,
        received:mock.received.length
      }),
      recentEvents:freeze(bus.recent({limit:40}).map(item=>freeze({
        event:item.event,
        source:item.meta?.source||null
      })))
    });
  }

  return freeze({
    version:NARA_UNIFIED_SIMULATION_VERSION,
    mode:NARA_UNIFIED_SIMULATION_MODE,
    runReasonSimulation,
    createMockCommandApproval,
    decideMockCommandApproval,
    runMockHumanALESimulation,
    evaluateFinalIntegrationBoundary,
    reportComponentHealth,
    recoveryRecommendation,
    snapshot
  });
}
