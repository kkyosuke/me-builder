import { gcpPlatformCommand } from "../src/gcp-platform-command";
import { obsoleteGcpPlatformResourceUrns } from "../src/gcp-platform-state-migration";
import { run } from "../src/process";
import { pulumiGcsBackends, requirePulumiGcsBackend } from "../src/pulumi-backend";

const operation = Bun.argv[2];
const environment = Bun.argv[3];
const command = gcpPlatformCommand(operation, environment, process.env);
const stack = command.at(command.indexOf("--stack") + 1);
if (!stack) throw new Error("Validated Pulumi command has no Stack");
const backendUrl = requirePulumiGcsBackend(process.env, pulumiGcsBackends.gcpPlatform);
await run(["pulumi", "login", backendUrl]);
await run(["pulumi", "-C", "gcp-platform", "whoami", "--verbose"]);

if (operation === "up") {
  const stackOutput = await run(
    ["pulumi", "-C", "gcp-platform", "stack", "--show-urns", "--stack", stack],
    { stdout: "pipe" },
  );
  for (const urn of obsoleteGcpPlatformResourceUrns(stackOutput)) {
    await run([
      "pulumi",
      "-C",
      "gcp-platform",
      "state",
      "unprotect",
      urn,
      "--stack",
      stack,
      "--yes",
    ]);
  }
}

await run(command);
