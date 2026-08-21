import { gcpPlatformCommand } from "../src/gcp-platform-command";
import { run } from "../src/process";

const command = gcpPlatformCommand(Bun.argv[2], Bun.argv[3], process.env);
await run(["pulumi", "whoami", "--verbose"]);
await run(command);
