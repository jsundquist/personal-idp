export interface Config {
  branchline?: {
    stepFunctions?: {
      /** AWS region the state machines live in (falls back to the SDK's default credential chain / region resolution when omitted) */
      region?: string;
      /**
       * Shared secret the waitForTaskToken Lambda must send as
       * `Authorization: Bearer <token>` when calling back to persist a task
       * token. Strongly recommended in production.
       * @visibility secret
       */
      callbackToken?: string;
      /**
       * Maps ASL state names to the Backstage groups allowed to act on them —
       * ASL has no native candidateGroups equivalent, so this app-config
       * mapping is the source of truth instead.
       */
      candidateGroups?: Array<{
        /** The Branchline definitionId — the value of the branchline:definitionId tag on the state machine */
        definitionId: string;
        /** The ASL state name (e.g. "Request Architecture Review") */
        taskId: string;
        groups: string[];
      }>;
    };
  };
}
