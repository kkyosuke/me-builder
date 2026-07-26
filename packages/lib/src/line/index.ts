import { client } from "./client";
import * as configModule from "./config";
import { liff } from "./liff";
import { webhook } from "./webhook";

export const line: {
  client: typeof client;
  webhook: typeof webhook;
  liff: typeof liff;
  config: typeof configModule;
} = {
  client,
  webhook,
  liff,
  config: configModule,
};

export namespace line {
  export type Config = configModule.LineConfig;
}

export { LineConfigSchema } from "./config";
export type { LineConfig } from "./config";
export type { LineClientConfig } from "./client";
export type {
  LiffViewType,
  RegisterLiffEndpointParams,
  RegisterLiffEndpointResult,
} from "./liff";
