import * as v from "valibot";

export const WorkerConfigSchema = v.object({
  environment: v.optional(v.string(), "development"),
  baseDomain: v.optional(v.string()),
  baseUrl: v.optional(v.string()),
  apiUrl: v.optional(v.string()),
  lineChannelAccessToken: v.optional(v.string()),
});

export type WorkerConfig = v.InferOutput<typeof WorkerConfigSchema>;
