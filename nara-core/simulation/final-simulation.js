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
  createIntegrationReadinessGate,
  READINESS_STATUS
} from '../readiness/index.js';
import {
  createNaraHumanALEBridge,
  createMockHumanALE
} from '../integration/index.js';

export const FINAL_SIMULATION_VERSION='1.0.0';
export const FINAL_SIMULATION_SCOPE='nara.final-simulation';
export const FINAL_SIMULATION_CAPABILITY='simulation.run';

const COMPONENTS=Object.freeze([
  'decision',
  'memory',
  'execution',
  'verification',
  'learning',
  'workflow',
  'integration'
]);

function safeInput(value){
  if(value===undefined)return {};
  return JSON.parse(JSON.stringify(value));
}

export function createFinalSimulationStack({
  now=()=>Date.now(),
  eventBus=createEventBus(),
  readinessFacts={}
}={}){
  const decisionEngine=createDecisionEngine({bus:eventBus,now});
  const memoryManager=createMemoryManager({bus:eventBus,now});
  const skillExecutor=createSkillExecutor({bus:eventBus,now});
  const verificationEngine=createVerificationEngine({bus:eventBus,now});
  const learningEngine=createLearningEngine({bus:eventBus,now});
  const supervisor=createSupervisor({bus:eventBus,now});
  const approvalManager=createApprovalManager({bus:eventBus,now});
  const readinessGate=createIntegrationReadinessGate({bus:eventBus,now});

  for(const id of COMPONENTS){
    supervisor.register({
      id,
      critical:true,
      allowDegraded:false
    });
  }

  skillExecutor.register({
    id:'simulation.reason',
    description:'Deterministic final-stack simulation skill.',
    handler:async input=>({
      kind:'nara-final-simulation-result',
      contextCount:Array.isArray(input?.context?.items)?input.context.items.length:0,
      requestAccepted:true
    })
  });

  verificationEngine.register({
    id:'simulation.result-shape',
    description:'Validate final simulation result schema.',
    handler:artifact=>({
      ok:Boolean(
        artifact&&
        artifact.kind==='nara-final-simulation-result'&&
        artifact.requestAccepted===true&&
        Number.isInteger(artifact.contextCount)&&
        artifact.contextCount>=0
      ),
      code:'SIMULATION_RESULT_SCHEMA'
    })
  });

  const workflow=createWorkflowOrchestrator({
    decisionEngine,
    memoryManager,
    skillExecutor,
    verificationEngine,
    learningEngine,
    bus:eventBus,
    now
  });

  const mockHumanALE=createMockHumanALE({
    online:true,
    health:'STARTING',
    now
  });
  const bridge=createNaraHumanALEBridge({
    transport:mockHumanALE,
    bus:eventBus,
    now
  });

  let facts={...readinessFacts};

  function setReadinessFacts(nextFacts){
    facts={...nextFacts};
    return readinessGate.evaluate(facts);
  }

  function requestApproval({
    id,
    requestedBy='simulation-operator',
    ttlMs,
    singleUse=true
  }={}){
    return approvalManager.create({
      id,
      capability:FINAL_SIMULATION_CAPABILITY,
      scope:FINAL_SIMULATION_SCOPE,
      requestedBy,
      ttlMs,
      singleUse
    });
  }

  function reportHealthy({latencyMs=1,timestamp}={}){
    return Object.freeze(COMPONENTS.map(componentId=>supervisor.report({
      componentId,
      status:'healthy',
      latencyMs,
      timestamp
    })));
  }

  function seedMemory({
    id='simulation-context',
    value={mode:'mock-only'},
    priority=1,
    tags=['simulation']
  }={}){
    return memoryManager.write({
      id,
      kind:'working',
      source:'final-simulation',
      sensitivity:'normal',
      priority,
      pinned:false,
      tags,
      value
    });
  }

  async function pingMockHumanALE(){
    const message=bridge.enqueue('system.ping',{
      mode:'final-simulation',
      liveTransport:false
    });
    const flushed=await bridge.flush();
    const starting=mockHumanALE.emit(
      'runtime.health',
      {state:'STARTING',reason:'final-simulation'},
      {id:'mock-health-starting-'+message.id}
    );
    bridge.receive(starting);
    mockHumanALE.setHealth('READY');
    const ready=mockHumanALE.emit(
      'runtime.health',
      {state:'READY',reason:'mock-ready'},
      {id:'mock-health-ready-'+message.id}
    );
    bridge.receive(ready);
    const pong=mockHumanALE.emit(
      'system.pong',
      {correlationId:message.id},
      {id:'mock-pong-'+message.id,correlationId:message.id}
    );
    bridge.receive(pong);
    return Object.freeze({
      outboundId:message.id,
      flush:Object.freeze({...flushed}),
      bridgeHealth:bridge.snapshot().health.state,
      mockHealth:mockHumanALE.snapshot().health,
      liveTransport:false
    });
  }

  async function run({
    approvalId,
    requestId='final-simulation-request',
    workflowId='final-simulation-workflow',
    input={probe:'final-stack'},
    contextTags=['simulation']
  }={}){
    const authorization=approvalManager.authorize({
      id:approvalId,
      capability:FINAL_SIMULATION_CAPABILITY,
      scope:FINAL_SIMULATION_SCOPE,
      consume:true
    });
    if(!authorization.allowed){
      return Object.freeze({
        version:FINAL_SIMULATION_VERSION,
        status:'BLOCKED',
        reason:'SIMULATION_APPROVAL_REQUIRED',
        authorization,
        liveHumanALE:false
      });
    }

    const readiness=readinessGate.evaluate(facts);
    if(!readiness.simulationReady){
      return Object.freeze({
        version:FINAL_SIMULATION_VERSION,
        status:'BLOCKED',
        reason:'SIMULATION_READINESS_INCOMPLETE',
        readiness,
        liveHumanALE:false
      });
    }

    const unhealthy=COMPONENTS
      .map(componentId=>({componentId,gate:supervisor.canRun(componentId)}))
      .filter(item=>item.gate.allowed!==true);
    if(unhealthy.length){
      return Object.freeze({
        version:FINAL_SIMULATION_VERSION,
        status:'BLOCKED',
        reason:'SUPERVISOR_GATE_BLOCKED',
        unhealthy:Object.freeze(unhealthy.map(item=>Object.freeze({
          componentId:item.componentId,
          reason:item.gate.reason
        }))),
        readiness,
        liveHumanALE:false
      });
    }

    const workflowReport=await workflow.run({
      workflowId,
      requestId,
      decisionRequest:{
        action:'skill.execute',
        capability:'simulation.reason',
        actor:'final-simulation',
        label:'Final NARA simulation'
      },
      decisionContext:{
        capabilities:{'simulation.reason':'ready'},
        deniedCapabilities:[],
        dependencies:{},
        gates:{},
        approvals:{}
      },
      contextRequest:{
        target:'simulation.reason',
        tags:contextTags,
        includeSensitive:false
      },
      skillId:'simulation.reason',
      input:safeInput(input),
      verifierIds:['simulation.result-shape']
    });

    if(workflowReport.status!=='COMPLETED'){
      return Object.freeze({
        version:FINAL_SIMULATION_VERSION,
        status:'FAILED',
        reason:'WORKFLOW_NOT_COMPLETED',
        workflow:workflowReport,
        readiness,
        liveHumanALE:false
      });
    }

    const mockHandshake=await pingMockHumanALE();
    const learningSnapshot=learningEngine.skillSnapshot('simulation.reason');

    return Object.freeze({
      version:FINAL_SIMULATION_VERSION,
      status:'SIMULATION_PASS',
      mode:'MOCK_HUMANALE_ONLY',
      liveHumanALE:false,
      readiness:Object.freeze({
        status:readiness.status,
        simulationReady:readiness.simulationReady,
        liveReady:readiness.liveReady,
        liveMissing:Object.freeze([...readiness.liveMissing])
      }),
      workflow:workflowReport,
      mockHandshake,
      learning:Object.freeze({
        sampleCount:learningSnapshot?.sampleCount??0,
        reliability:learningSnapshot?.metrics?.reliability??null,
        failureRate:learningSnapshot?.metrics?.failureRate??null
      })
    });
  }

  return Object.freeze({
    eventBus,
    decisionEngine,
    memoryManager,
    skillExecutor,
    verificationEngine,
    learningEngine,
    workflow,
    supervisor,
    approvalManager,
    readinessGate,
    bridge,
    mockHumanALE,
    requestApproval,
    reportHealthy,
    seedMemory,
    setReadinessFacts,
    pingMockHumanALE,
    run,
    get mode(){return 'MOCK_HUMANALE_ONLY';},
    get components(){return COMPONENTS;}
  });
}

export function finalSimulationReadinessFacts({
  humanaleRealTestPass=false,
  humanaleFinalReady=false,
  humanaleBaselineFrozen=false
}={}){
  return Object.freeze({
    'nara.decision.validated':true,
    'nara.memory.validated':true,
    'nara.execution.validated':true,
    'nara.verification.validated':true,
    'nara.learning.validated':true,
    'nara.workflow.validated':true,
    'nara.supervisor.validated':true,
    'nara.approval.validated':true,
    'integration.contract_validated':true,
    'integration.mock_bridge_validated':true,
    'security.codeql_pass':true,
    'security.quality_gate_pass':true,
    'humanale.real_test_pass':humanaleRealTestPass===true,
    'humanale.final_ready':humanaleFinalReady===true,
    'humanale.baseline_frozen':humanaleBaselineFrozen===true
  });
}

export function assertSimulationOnly(report){
  if(!report||report.status!=='SIMULATION_PASS')throw new Error('Final simulation did not pass.');
  if(report.liveHumanALE!==false||report.mode!=='MOCK_HUMANALE_ONLY'){
    throw new Error('Simulation boundary violation.');
  }
  if(report.readiness.status===READINESS_STATUS.LIVE_READY){
    return report;
  }
  return report;
}
