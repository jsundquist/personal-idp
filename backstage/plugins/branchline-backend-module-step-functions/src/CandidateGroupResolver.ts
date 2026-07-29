import { Config } from '@backstage/config';

/**
 * ASL has no native "who can act on this task" concept the way BPMN's
 * zeebe:assignmentDefinition candidateGroups does, so Step Functions sources
 * it from app-config instead:
 *
 *   branchline:
 *     stepFunctions:
 *       candidateGroups:
 *         - definitionId: create-backend-api
 *           taskId: "Request Architecture Review"
 *           groups: [architects]
 *
 * (An array of entries, not a nested-key map, because ASL state names can
 * contain spaces and other characters that aren't safe as bare YAML keys.)
 */
export class CandidateGroupResolver {
  private readonly entries: Array<{ definitionId: string; taskId: string; groups: string[] }>;

  constructor(config: Config) {
    const raw = config.getOptionalConfigArray('branchline.stepFunctions.candidateGroups') ?? [];
    this.entries = raw.map(entry => ({
      definitionId: entry.getString('definitionId'),
      taskId: entry.getString('taskId'),
      groups: entry.getStringArray('groups'),
    }));
  }

  resolve(definitionId: string, taskId: string): string[] {
    const entry = this.entries.find(e => e.definitionId === definitionId && e.taskId === taskId);
    return entry?.groups ?? [];
  }
}
