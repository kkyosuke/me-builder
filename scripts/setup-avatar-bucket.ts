import { parseEnvironment, resourceNames } from "../infra/src/environment";

const environment = parseEnvironment(process.argv[2] ?? "");
const names = resourceNames(environment);
for (const bucketName of [names.avatarBucket, names.photoDiaryBucket]) {
  const processResult = Bun.spawn(
    [
      "bun",
      "wrangler",
      "r2",
      "bucket",
      "create",
      bucketName,
      "--location",
      "apac",
      "--storage-class",
      "Standard",
    ],
    {
      cwd: new URL("../apps/api", import.meta.url).pathname,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    processResult.exited,
    new Response(processResult.stdout).text(),
    new Response(processResult.stderr).text(),
  ]);
  const output = `${stdout}\n${stderr}`;
  if (exitCode !== 0 && !/already exists|already taken|code:\s*(?:10020|11009)/i.test(output)) {
    throw new Error(`Failed to create private R2 bucket ${bucketName}: ${output.trim()}`);
  }
  console.info(
    exitCode === 0 ? `Created ${bucketName}` : `R2 bucket already exists: ${bucketName}`,
  );
}
