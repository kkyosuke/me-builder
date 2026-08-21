import { gcpPlatformCommand } from "../src/gcp-platform-command";
import { run } from "../src/process";
import { pulumiGcsBackends, requirePulumiGcsBackend } from "../src/pulumi-backend";

const command = gcpPlatformCommand(Bun.argv[2], Bun.argv[3], process.env);
const backendUrl = requirePulumiGcsBackend(process.env, pulumiGcsBackends.gcpPlatform);
await run(["pulumi", "login", backendUrl]);
await run(["pulumi", "whoami", "--verbose"]);
await run(command);
