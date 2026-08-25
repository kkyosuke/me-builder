import { gcpPlatformCommand } from "../src/gcp-platform-command";
import { run } from "../src/process";
import { pulumiGcsBackends, requirePulumiGcsBackend } from "../src/pulumi-backend";

const operation = Bun.argv[2];
const environment = Bun.argv[3];
const command = gcpPlatformCommand(operation, environment, process.env);
const backendUrl = requirePulumiGcsBackend(process.env, pulumiGcsBackends.gcpPlatform);
await run(["pulumi", "login", backendUrl]);
await run(["pulumi", "-C", "gcp-platform", "whoami", "--verbose"]);
await run(command);
