import { client } from "./client";
import * as configModule from "./config";
import { idToken } from "./id-token";
import { liff } from "./liff";
import { lineText } from "./text";
import { webhook } from "./webhook";

export const line: {
  client: typeof client;
  webhook: typeof webhook;
  liff: typeof liff;
  idToken: typeof idToken;
  config: typeof configModule;
  text: typeof lineText;
} = {
  client,
  webhook,
  liff,
  idToken,
  config: configModule,
  text: lineText,
};

export namespace line {
  export type Config = configModule.LineConfig;
}

export { LineConfigSchema } from "./config";
export type { LineConfig } from "./config";
export type { LineClientConfig } from "./client";
export { classifyLineText } from "./text";
export type { LineTextIntent } from "./text";
export type {
  LiffViewType,
  RegisterLiffEndpointParams,
  RegisterLiffEndpointResult,
} from "./liff";
export type { VerifiedIdToken, VerifyIdTokenParams, VerifyIdTokenResult } from "./id-token";
