import * as v from "valibot";

export const LineConfigSchema = v.object({
  channelAccessToken: v.optional(v.string()),
  webhookUrl: v.optional(v.string()),
});

export type LineConfig = v.InferOutput<typeof LineConfigSchema>;
