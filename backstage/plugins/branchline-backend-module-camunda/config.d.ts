export interface Config {
  branchline?: {
    camunda?: {
      /** Base URL for the Camunda Operate API (e.g. http://localhost:8081) */
      operateBaseUrl: string;
      /** Base URL for the Camunda Zeebe REST gateway (e.g. http://localhost:8080) */
      zeebeBaseUrl: string;
      /** Base URL for the Camunda Tasklist API (e.g. http://localhost:8082) */
      tasklistBaseUrl: string;
      /** OAuth2 client ID for Camunda Identity (omit when using username/password auth) */
      clientId?: string;
      /** @visibility secret */
      clientSecret?: string;
      /** OAuth2 token endpoint URL (omit when using username/password auth) */
      tokenUrl?: string;
      /** Username for Camunda basic/cookie auth (e.g. demo). Enables cookie-auth mode when set with password. */
      username?: string;
      /** @visibility secret */
      password?: string;
    };
  };
}
