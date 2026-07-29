/** Minimal typed shape of an Amazon States Language document — only the
 *  fields Branchline's adapter needs to read. */

export interface AslChoiceRule {
  Condition?: string;
  Next: string;
}

export interface AslBranch {
  StartAt: string;
  States: Record<string, AslState>;
}

export interface AslState {
  Type: 'Task' | 'Choice' | 'Parallel' | 'Pass' | 'Wait' | 'Succeed' | 'Fail' | 'Map';
  Comment?: string;
  Resource?: string;
  Next?: string;
  End?: boolean;
  Branches?: AslBranch[];
  Choices?: AslChoiceRule[];
  Default?: string;
}

export interface AslDefinition {
  Comment?: string;
  StartAt: string;
  States: Record<string, AslState>;
}

export function parseAslDefinition(json: string): AslDefinition {
  return JSON.parse(json) as AslDefinition;
}

/** Top-level phase names: single-branch Parallel states directly in the root
 *  States map — mirrors how BpmnAdapter treats direct-child subProcesses. */
export function listPhaseNames(definition: AslDefinition): string[] {
  return Object.entries(definition.States)
    .filter(([, state]) => state.Type === 'Parallel' && (state.Branches?.length ?? 0) === 1)
    .map(([name]) => name);
}
