export interface CamundaProcessDefinition {
  key: string;
  name: string;
  version: number;
  bpmnProcessId: string;
}

export interface CamundaProcessInstance {
  key: string;
  processDefinitionKey: string;
  bpmnProcessId: string;
  state: 'ACTIVE' | 'COMPLETED' | 'CANCELED';
}

export interface CamundaElementInstance {
  key: string;
  processInstanceKey: string;
  processDefinitionKey: string;
  flowNodeId: string;
  flowNodeName?: string;
  type: string;
  state: 'ACTIVE' | 'COMPLETED' | 'TERMINATED';
  flowScopeKey?: string;
  jobKey?: string;
}

export interface CamundaSearchResponse<T> {
  items: T[];
  total: number;
}

export interface StartProcessInstanceRequest {
  processDefinitionId: string;
  variables?: Record<string, unknown>;
}

export interface StartProcessInstanceResponse {
  processInstanceKey: string;
}
