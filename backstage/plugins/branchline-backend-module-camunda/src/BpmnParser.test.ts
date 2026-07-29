import { parseBpmnXml, buildHierarchyFromBpmn } from './BpmnParser';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
  <bpmn:process id="p" isExecutable="true">
    <bpmn:subProcess id="phase-1" name="Phase 1">
      <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:userTask id="review" name="Review">
        <bpmn:extensionElements>
          <zeebe:assignmentDefinition candidateGroups="arb, security" />
        </bpmn:extensionElements>
        <bpmn:incoming>f1</bpmn:incoming>
        <bpmn:outgoing>f2</bpmn:outgoing>
      </bpmn:userTask>
      <bpmn:userTask id="self" name="Self Serve">
        <bpmn:incoming>f2</bpmn:incoming>
        <bpmn:outgoing>f3</bpmn:outgoing>
      </bpmn:userTask>
      <bpmn:userTask id="dynamic" name="Dynamic">
        <bpmn:extensionElements>
          <zeebe:assignmentDefinition candidateGroups="=someVar" />
        </bpmn:extensionElements>
        <bpmn:incoming>f3</bpmn:incoming>
        <bpmn:outgoing>f4</bpmn:outgoing>
      </bpmn:userTask>
      <bpmn:userTask id="log-ticket" name="Log Ticket">
        <bpmn:extensionElements>
          <zeebe:taskHeaders>
            <zeebe:header key="branchlineFormKey" value="log-ticket" />
          </zeebe:taskHeaders>
        </bpmn:extensionElements>
        <bpmn:incoming>f4</bpmn:incoming>
        <bpmn:outgoing>f5</bpmn:outgoing>
      </bpmn:userTask>
      <bpmn:endEvent id="e"><bpmn:incoming>f5</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="review" />
      <bpmn:sequenceFlow id="f2" sourceRef="review" targetRef="self" />
      <bpmn:sequenceFlow id="f3" sourceRef="self" targetRef="dynamic" />
      <bpmn:sequenceFlow id="f4" sourceRef="dynamic" targetRef="log-ticket" />
      <bpmn:sequenceFlow id="f5" sourceRef="log-ticket" targetRef="e" />
    </bpmn:subProcess>
  </bpmn:process>
</bpmn:definitions>`;

describe('BpmnParser candidateGroups', () => {
  it('parses literal candidateGroups, leaves ungrouped and FEEL tasks unset', () => {
    const blocks = buildHierarchyFromBpmn(parseBpmnXml(xml), [], []);
    const tasks = blocks.flatMap(b => b.steps.flatMap(s => s.tasks));
    const byId = Object.fromEntries(tasks.map(t => [t.id, t]));

    expect(byId.review.candidateGroups).toEqual(['arb', 'security']);
    expect(byId.review.candidateGroupsUnresolved).toBeFalsy();
    expect(byId.self.candidateGroups).toBeUndefined();
    expect(byId.self.candidateGroupsUnresolved).toBeFalsy();
    // A FEEL expression (=someVar) cannot be statically resolved — flagged so
    // callers deny by default instead of treating it as self-serve.
    expect(byId.dynamic.candidateGroups).toBeUndefined();
    expect(byId.dynamic.candidateGroupsUnresolved).toBe(true);
  });
});

describe('BpmnParser formKey', () => {
  it('parses the branchlineFormKey task header, leaves other tasks unset', () => {
    const blocks = buildHierarchyFromBpmn(parseBpmnXml(xml), [], []);
    const tasks = blocks.flatMap(b => b.steps.flatMap(s => s.tasks));
    const byId = Object.fromEntries(tasks.map(t => [t.id, t]));

    expect(byId['log-ticket'].formKey).toBe('log-ticket');
    expect(byId.review.formKey).toBeUndefined();
    expect(byId.self.formKey).toBeUndefined();
  });
});
