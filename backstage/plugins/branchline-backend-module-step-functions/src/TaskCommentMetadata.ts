/**
 * ASL has no native "who can act on this task" concept the way BPMN's
 * zeebe:assignmentDefinition candidateGroups does, so Step Functions embeds
 * the equivalent metadata directly in a Task state's `Comment` field, as a
 * JSON object:
 *
 *   "Request Architecture Review": {
 *     "Type": "Task",
 *     "Comment": "{\"candidateGroups\":[\"architects\"]}",
 *     ...
 *   }
 *
 * This mirrors Camunda's approach of carrying gating metadata inside the
 * workflow definition itself, rather than a separate app-config mapping that
 * workflow authors would otherwise have to remember to keep in sync.
 *
 * `Comment` is a free-text field per the ASL spec, so the convention is:
 * the whole field is either absent/empty, or a valid JSON object as above.
 * Anything else (plain human text, malformed JSON) is treated as "no gating
 * declared" — self-serve, matching a BPMN task with no assignmentDefinition
 * at all. There is no "unresolved/deny-by-default" case here: unlike a BPMN
 * FEEL expression, ASL has no dynamic-expression mechanism this could fail to
 * statically resolve — parsing either succeeds (explicit gating) or falls
 * back to self-serve.
 */
export interface TaskCommentMetadata {
  candidateGroups: string[];
  formKey?: string;
}

export function parseTaskComment(comment: string | undefined): TaskCommentMetadata {
  if (!comment) {
    return { candidateGroups: [] };
  }
  try {
    const parsed = JSON.parse(comment);
    const candidateGroups = Array.isArray(parsed?.candidateGroups)
      ? parsed.candidateGroups.filter((g: unknown): g is string => typeof g === 'string')
      : [];
    const formKey = typeof parsed?.formKey === 'string' ? parsed.formKey : undefined;
    return { candidateGroups, formKey };
  } catch {
    // Not valid JSON — treat as a plain human comment, not gating metadata.
    return { candidateGroups: [] };
  }
}
