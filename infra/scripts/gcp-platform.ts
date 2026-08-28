import { gcpPlatformCommand } from "../src/gcp-platform-command";
import { prepareObsoleteGcpPlatformState } from "../src/gcp-platform-obsolete-state";
import { run } from "../src/process";
import { pulumiGcsBackends, requirePulumiGcsBackend } from "../src/pulumi-backend";

const operation = Bun.argv[2];
const environment = Bun.argv[3];
if (environment === undefined) {
  throw new Error("GCP platform environment must be development or production");
}
const command = gcpPlatformCommand(operation, environment, process.env);
const backendUrl = requirePulumiGcsBackend(process.env, pulumiGcsBackends.gcpPlatform);
await run(["pulumi", "login", backendUrl]);
await run(["pulumi", "-C", "gcp-platform", "whoami", "--verbose"]);

if (operation === "up") {
  const stackExport = await run(
    ["pulumi", "-C", "gcp-platform", "stack", "export", "--stack", environment],
    { stdout: "pipe" },
  );
  const migration = prepareObsoleteGcpPlatformState(stackExport);
  if (migration.migratedResourceCount > 0) {
    console.log(
      `Preparing cleanup for ${migration.migratedResourceCount} obsolete GCP platform resources`,
    );
    await run(["pulumi", "-C", "gcp-platform", "stack", "import", "--stack", environment], {
      stdin: migration.deployment,
    });
  }
}

await run(command);
