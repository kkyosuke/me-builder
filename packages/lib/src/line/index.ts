import { client } from "./client";
import * as configModule from "./config";
import { webhook } from "./webhook";

export const line: {
  client: typeof client;
  webhook: typeof webhook;
  config: typeof configModule;
} = {
  client,
  webhook,
  config: configModule,
};

export namespace line {
  export type Config = configModule.LineConfig;
}

export { LineConfigSchema } from "./config";
export type { LineConfig } from "./config";
export type { LineClientConfig } from "./client";
