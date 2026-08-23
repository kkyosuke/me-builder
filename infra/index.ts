import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";
import { parseEnvironment, resourceNames } from "./src/environment.ts";

const config = new pulumi.Config();
const environment = parseEnvironment(config.require("environment"));
const baseDomain = config.require("baseDomain");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!accountId) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID is required");
}

const names = resourceNames(environment);
const protect = environment === "production";
const database = new cloudflare.D1Database(
  "database",
  {
    accountId,
    name: names.database,
    primaryLocationHint: "apac",
  },
  { protect },
);

const avatarBucket = new cloudflare.R2Bucket(
  "avatarBucket",
  {
    accountId,
    name: names.avatarBucket,
    location: "apac",
    storageClass: "Standard",
  },
  { protect },
);

const photoDiaryBucket = new cloudflare.R2Bucket(
  "photoDiaryBucket",
  {
    accountId,
    name: names.photoDiaryBucket,
    location: "apac",
    storageClass: "Standard",
  },
  { protect },
);

const sessionStore = new cloudflare.WorkersKvNamespace(
  "sessionStore",
  {
    accountId,
    title: names.sessionStore,
  },
  { protect },
);

const queues = Object.fromEntries(
  Object.entries(names.queues).map(([key, queueName]) => [
    key,
    new cloudflare.Queue(key, { accountId, queueName }, { protect }),
  ]),
);

export const infrastructure = {
  environment,
  baseDomain,
  database: {
    id: database.uuid,
    name: database.name,
  },
  avatarBucket: {
    name: avatarBucket.name,
  },
  photoDiaryBucket: {
    name: photoDiaryBucket.name,
  },
  sessionStore: {
    id: sessionStore.id,
    name: sessionStore.title,
  },
  queues: Object.fromEntries(
    Object.entries(queues).map(([key, queue]) => [
      key,
      {
        id: queue.queueId,
        name: queue.queueName,
      },
    ]),
  ),
};
