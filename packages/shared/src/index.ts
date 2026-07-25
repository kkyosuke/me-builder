// 共有ドメイン型および定数定義のプレースホルダー
export interface UserProfile {
  id: string;
  name: string;
  email?: string;
}

export const APP_NAME = "me-builder";

export * from "./schema/queue";
export * from "./utils/env";
export * from "./utils/logger";
