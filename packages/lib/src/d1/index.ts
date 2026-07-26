import * as action from "./action";
import { type D1Client, createD1Client } from "./client";
import * as schema from "./schema";

export const d1 = {
  client: {
    create: createD1Client,
  },
  action,
  schema,
};

export namespace d1 {
  export type Client = D1Client;
}

export { createD1Client } from "./client";
export type { D1Client } from "./client";
export { action, schema };
export * from "./action";
