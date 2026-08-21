# Infrastructure

`infra/` contains two independent Pulumi projects:

- the root project manages the Cloudflare D1 database, private avatar R2 bucket, KV namespace, and Queue resources
- [`gcp-platform/`](./gcp-platform/) manages separate development and production GCP projects for Identity Platform and Vertex AI

Wrangler still deploys Worker bundles, secrets, bindings, and Durable Object migrations. The ownership boundary and deletion order are defined in [the infrastructure architecture](../docs/architecture/infrastructure-architecture.md#61-cloudflareリソースの宣言とデプロイ境界).

## Requirements

- Pulumi CLI
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` with D1, R2, Queues, and Workers Scripts edit permissions
- an existing Google Cloud project and separate GCS buckets for Cloudflare and GCP Pulumi state
- `PULUMI_BACKEND_URL` set to the bucket for the Pulumi project being operated as a `gs://` URL
- a non-empty `PULUMI_CONFIG_PASSPHRASE`, supplied from a password manager locally and from GitHub Secrets in CI

The GCP platform project additionally requires Application Default Credentials, project creation permission, Billing Account User permission, and permission to manage service accounts, IAM bindings, and API keys. See its [setup guide](./gcp-platform/README.md).

## State backend

The state project and buckets are bootstrap prerequisites and are not created or deleted by either Pulumi project in this repository. Each bucket must have uniform bucket-level access, public access prevention, and object versioning enabled. Local operators need access to both buckets; each CI principal receives access only to the bucket used by its Pulumi project.

Both Pulumi projects require an explicit GCS backend and reject an unset backend, `file://`, Pulumi Cloud, and non-GCS object stores. Separate buckets and passphrases prevent the Preview CI principal from reading, replacing, or deleting GCP application state.

```bash
export PULUMI_BACKEND_URL=gs://<existing-cloudflare-state-bucket>/me-builder
export PULUMI_CONFIG_PASSPHRASE=<cloudflare-value-from-password-manager>
pulumi login "$PULUMI_BACKEND_URL"
```

For local operations, `gcloud auth application-default login` supplies credentials for the GCS backend. The operator must have access to both the state bucket and the cloud resources being managed. Do not create a service-account JSON key.

The `Reset / Preview Migrations` workflow authenticates with GitHub OIDC and Workload Identity Federation. Configure these GitHub Actions values at repository level or in Environment `dev` before running it:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `PULUMI_BACKEND_URL` | `gs://<existing-cloudflare-state-bucket>/me-builder` |
| Secret | `PULUMI_CONFIG_PASSPHRASE` | the non-empty passphrase for the Cloudflare Stack |
| Variable | `GCP_STATE_PROJECT_ID` | the project that owns the existing Cloudflare state bucket |
| Variable | `GCP_WORKLOAD_IDENTITY_PROVIDER` | the full Workload Identity Provider resource name restricted to this repository |
| Variable | `GCP_PULUMI_STATE_SERVICE_ACCOUNT` | the service account impersonated by GitHub Actions |

The Workload Identity principal must be allowed to impersonate only the configured service account, and that service account must have object access only to the Cloudflare state bucket. Do not grant it any access to the GCP platform state bucket. The workflow does not accept a JSON key fallback.

An empty GCS backend has no knowledge of the existing Cloudflare resources. For the first adoption, either import every resource into the `preview` Stack or run the destructive `Reset / Preview Migrations` workflow after reviewing its deletion scope. Do not run a normal `infra:preview:up` against an empty backend while the named resources still exist.

## Preview lifecycle

```bash
task infra:preview:up

ALLOW_PREVIEW_DESTROY=preview task infra:preview:destroy

task infra:preview:up
```

`infra:preview:up` updates Pulumi resources, writes the current non-secret resource IDs to `infra/environments/preview.json`, and regenerates the four checked-in `wrangler.toml` files. Run the existing D1 migration and deployment tasks after creation.

Normal Preview CD creates the named private avatar bucket and application-session KV namespace if they are missing before discovering the live infrastructure. Production CD performs the same idempotent bootstrap because Production foundation resources are not recreated by the Preview-only Pulumi lifecycle.

`infra:preview:clean` is only for the one-time adoption of an existing unmanaged Preview environment. It also removes orphaned `me-builder-*-preview` queues that are no longer declared by the Pulumi program. Preview destruction empties the private avatar bucket before Pulumi removes it. Both destructive commands require `ALLOW_PREVIEW_DESTROY=preview`; there is no Production destroy command.

The `Reset / Preview Migrations` manual workflow performs the clean recreation and application redeployment from the selected branch. Because recreation changes Cloudflare resource IDs, the workflow also commits the updated manifest and generated TOML files according to the branch rules documented in the workflow. Normal Preview CD runs `infra:preview:sync` before migrations so deployment remains valid while generated changes are awaiting merge.
