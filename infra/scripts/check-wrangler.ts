import { configPaths, expectedWranglerConfigs } from "../src/config-files";

const expected = await expectedWranglerConfigs();
const mismatches: string[] = [];
for (const key of Object.keys(configPaths) as (keyof typeof configPaths)[]) {
  if ((await Bun.file(configPaths[key]).text()) !== expected[key])
    mismatches.push(configPaths[key]);
}
if (mismatches.length > 0) {
  throw new Error(`Generated Wrangler configs are stale:\n${mismatches.join("\n")}`);
}
console.info("Wrangler configs match Pulumi stack outputs");
