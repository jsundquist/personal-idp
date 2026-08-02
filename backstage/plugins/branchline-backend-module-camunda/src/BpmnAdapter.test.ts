import { bpmnToFlowGraph } from './BpmnAdapter';
import type { CamundaElementInstance } from './types';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="p" isExecutable="true">
    <bpmn:subProcess id="phase-1" name="Phase 1">
      <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:userTask id="self" name="Self Serve">
        <bpmn:incoming>f1</bpmn:incoming>
        <bpmn:outgoing>f2</bpmn:outgoing>
      </bpmn:userTask>
      <bpmn:endEvent id="e"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="self" />
      <bpmn:sequenceFlow id="f2" sourceRef="self" targetRef="e" />
    </bpmn:subProcess>
  </bpmn:process>
</bpmn:definitions>`;

describe('bpmnToFlowGraph element instance key ordering', () => {
  it('picks the numerically latest instance, not the lexically latest', () => {
    // "9" > "10" lexically but not numerically — a naive string comparison
    // would pick the wrong (older) instance as "most recent".
    const instances: CamundaElementInstance[] = [
      {
        key: '9',
        processInstanceKey: 'pi-1',
        processDefinitionKey: 'pd-1',
        flowNodeId: 'self',
        type: 'bpmn:userTask',
        state: 'COMPLETED',
      },
      {
        key: '10',
        processInstanceKey: 'pi-1',
        processDefinitionKey: 'pd-1',
        flowNodeId: 'self',
        type: 'bpmn:userTask',
        state: 'ACTIVE',
      },
    ];
    const graph = bpmnToFlowGraph(xml, instances, []);
    const node = graph.nodes.find(n => n.id === 'self');

    expect(node?.status).toBe('active');
  });
});
