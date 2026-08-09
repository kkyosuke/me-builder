const environment = process.argv[2];
if (environment !== "preview" && environment !== "production") {
  throw new Error("Usage: bun scripts/setup-chat-queues.ts <preview|production>");
}

const queueNames = [
  `me-builder-chat-turn-queue-${environment}`,
  `me-builder-chat-turn-dlq-${environment}`,
  `me-builder-brain-checkpoint-queue-${environment}`,
  `me-builder-brain-checkpoint-dlq-${environment}`,
  `me-builder-webhook-dlq-${environment}`,
  `me-builder-avatar-queue-${environment}`,
  `me-builder-avatar-dlq-${environment}`,
];

for (const queueName of queueNames) {
  const processResult = Bun.spawn(
    ["bun", "--cwd", "apps/worker", "wrangler", "queues", "create", queueName],
    { stdout: "pipe", stderr: "pipe", env: process.env },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    processResult.exited,
    new Response(processResult.stdout).text(),
    new Response(processResult.stderr).text(),
  ]);
  const output = `${stdout}\n${stderr}`;
  if (exitCode !== 0 && !/already exists|already taken|code:\s*(?:10020|11009)/i.test(output)) {
    throw new Error(`Failed to create Queue ${queueName}: ${output.trim()}`);
  }
  console.info(exitCode === 0 ? `Created ${queueName}` : `Queue already exists: ${queueName}`);
}

const bucketName = `me-builder-avatar-${environment}`;
const bucketProcess = Bun.spawn(
  ["bun", "--cwd", "apps/worker", "wrangler", "r2", "bucket", "create", bucketName],
  { stdout: "pipe", stderr: "pipe", env: process.env },
);
const [bucketExitCode, bucketStdout, bucketStderr] = await Promise.all([
  bucketProcess.exited,
  new Response(bucketProcess.stdout).text(),
  new Response(bucketProcess.stderr).text(),
]);
const bucketOutput = `${bucketStdout}\n${bucketStderr}`;
if (bucketExitCode !== 0 && !/already exists|already taken/i.test(bucketOutput)) {
  throw new Error(`Failed to create R2 bucket ${bucketName}: ${bucketOutput.trim()}`);
}
console.info(
  bucketExitCode === 0 ? `Created ${bucketName}` : `R2 bucket already exists: ${bucketName}`,
);
