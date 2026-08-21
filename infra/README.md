# Infrastructure

`infra/` contains two independent Pulumi projects:

- the root project manages the Cloudflare D1 database, private avatar R2 bucket, KV namespace, and Queue resources
- [`gcp-platform/`](./gcp-platform/) manages separate development and production GCP projects for Identity Platform and Vertex AI

Wrangler still deploys Worker bundles, secrets, bindings, and Durable Object migrations. The ownership boundary and deletion order are defined in [the infrastructure architecture](../docs/architecture/infrastructure-architecture.md#61-cloudflareリソースの宣言とデプロイ境界).

## Requirements

- Pulumi CLI
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` with D1, R2, Queues, and Workers Scripts edit permissions
- A durable Pulumi backend configured with `PULUMI_BACKEND_URL` for shared operation

The GCP platform project additionally requires Application Default Credentials, project creation permission, Billing Account User permission, and permission to manage service accounts, IAM bindings, and API keys. See its [setup guide](./gcp-platform/README.md).

If `PULUMI_BACKEND_URL` is omitted, commands use the ignored `infra/.pulumi-state` local backend. This is useful for local verification only; it must not be treated as shared state.

## Preview lifecycle

```bash
task infra:preview:up

ALLOW_PREVIEW_DESTROY=preview task infra:preview:destroy

task infra:preview:up
```

`infra:preview:up` updates Pulumi resources, writes the current non-secret resource IDs to `infra/environments/preview.json`, and regenerates the four checked-in `wrangler.toml` files. Run the existing D1 migration and deployment tasks after creation.

Normal Preview CD creates the named private avatar bucket and application-session KV namespace if they are missing before discovering the live infrastructure. Production CD performs the same idempotent bootstrap because Production foundation resources are not recreated by the Preview-only Pulumi lifecycle.

`infra:preview:clean` is only for the one-time adoption of an existing unmanaged Preview environment. It also removes orphaned `me-builder-*-preview` queues that are no longer declared by the Pulumi program. Preview destruction empties the private avatar bucket before Pulumi removes it. Both destructive commands require `ALLOW_PREVIEW_DESTROY=preview`; there is no Production destroy command.

The `Reset / Preview Migrations` manual workflow performs the clean recreation and application redeployment from the latest `main`. Because recreation changes Cloudflare resource IDs, the workflow also opens a PR containing the updated manifest and generated TOML files. Normal Preview CD runs `infra:preview:sync` before migrations so deployment remains valid while that generated PR is awaiting merge.
