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
    };
  };
}
