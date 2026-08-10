import { configPaths, expectedWranglerConfigs } from "../src/config-files";

const configs = await expectedWranglerConfigs();
await Promise.all([
  Bun.write(configPaths.worker, configs.worker),
  Bun.write(configPaths.api, configs.api),
  Bun.write(configPaths.mcp, configs.mcp),
  Bun.write(configPaths.lib, configs.lib),
]);

console.info("Generated Wrangler configs from infra/environments/*.json");
