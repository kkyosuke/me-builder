import { client } from "./client";
import * as configModule from "./config";
import * as configurationModule from "./configuration";
import { idToken } from "./id-token";
import { liff } from "./liff";
import { richMenu } from "./rich-menu";
import { lineText } from "./text";
import { webhook } from "./webhook";

export const line: {
  client: typeof client;
  webhook: typeof webhook;
  liff: typeof liff;
  richMenu: typeof richMenu;
  idToken: typeof idToken;
  config: typeof configModule;
  configuration: typeof configurationModule;
  text: typeof lineText;
} = {
  client,
  webhook,
  liff,
  richMenu,
  idToken,
  config: configModule,
  configuration: configurationModule,
  text: lineText,
};

export namespace line {
  export type Config = configModule.LineConfig;
}

export { LineConfigSchema } from "./config";
export type { LineConfig } from "./config";
export { resolveLiffConfiguration } from "./configuration";
export type { LiffConfiguration } from "./configuration";
export type { LineClientConfig } from "./client";
export { classifyLineText } from "./text";
export type { LineTextIntent } from "./text";
export type {
  LiffViewType,
  RegisterLiffEndpointParams,
  RegisterLiffEndpointResult,
} from "./liff";
export type {
  RegisterDefaultRichMenuParams,
  RegisterDefaultRichMenuResult,
} from "./rich-menu";
export type { VerifiedIdToken, VerifyIdTokenParams, VerifyIdTokenResult } from "./id-token";
