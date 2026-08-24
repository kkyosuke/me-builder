import { gcpPlatformCommand } from "../src/gcp-platform-command";
import { prepareGcpPlatformStateMigration } from "../src/gcp-platform-state-migration";
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
  const stackExport = await run(
    ["pulumi", "-C", "gcp-platform", "stack", "export", "--stack", stack],
    { stdout: "pipe" },
  );
  const migration = prepareGcpPlatformStateMigration(stackExport);
  if (migration.migratedResourceCount > 0) {
    console.log(
      `Preparing one-time cleanup for ${migration.migratedResourceCount} obsolete GCP platform resources`,
    );
    await run(["pulumi", "-C", "gcp-platform", "stack", "import", "--stack", stack], {
      stdin: migration.deployment,
    });
  }
}

await run(command);
