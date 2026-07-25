import * as v from "valibot";

export const WebConfigSchema = v.object({
  environment: v.optional(v.string(), "development"),
  baseDomain: v.optional(v.string()),
  baseUrl: v.optional(v.string()),
  apiUrl: v.optional(v.string()),
});

export type WebConfig = v.InferOutput<typeof WebConfigSchema>;
