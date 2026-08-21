# Infrastructure

`infra/` contains two independent Pulumi projects:

- the root project manages the Cloudflare D1 database, private avatar R2 bucket, KV namespace, and Queue resources
- [`gcp-platform/`](./gcp-platform/) manages separate development and production GCP projects for Identity Platform and Vertex AI

Wrangler still deploys Worker bundles, secrets, bindings, and Durable Object migrations. The ownership boundary and deletion order are defined in [the infrastructure architecture](../docs/architecture/infrastructure-architecture.md#61-cloudflareリソースの宣言とデプロイ境界).

## Requirements

- Pulumi CLI
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` with D1, R2, Queues, and Workers Scripts edit permissions
- an existing Google Cloud state project; the bootstrap workflow creates `gs://kagami-infra/` and its managed folders
- a non-empty `PULUMI_CONFIG_PASSPHRASE`, supplied from a password manager locally and from GitHub Secrets in CI

The GCP platform project additionally requires Application Default Credentials, project creation permission, Billing Account User permission, and permission to manage service accounts, IAM bindings, and API keys. See its [setup guide](./gcp-platform/README.md).

## One-time state backend bootstrap

The state project is a bootstrap prerequisite and is not created or deleted by either Pulumi project in this repository. Create the bucket and managed folders once with the manual [`Setup / Pulumi State Backend`](../.github/workflows/setup-pulumi-state.yml) workflow. The workflow is idempotent: it preserves an existing bucket, verifies its immutable location, and reconciles its mutable security, storage-class, and versioning settings.

Create a protected GitHub Environment named `infra-bootstrap`, then configure these Environment variables:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `GCP_STATE_PROJECT_ID` | the existing project that owns `gs://kagami-infra/` |
| Variable | `GCP_WORKLOAD_IDENTITY_PROVIDER` | the full Workload Identity Provider resource name restricted to this repository and the `main` branch |
| Variable | `GCP_STATE_BOOTSTRAP_SERVICE_ACCOUNT` | the dedicated service account impersonated only by the bootstrap workflow |

The workflow cannot create the identity that it uses to authenticate. Create the Workload Identity Pool/Provider, bootstrap service account, repository-and-`main`-restricted impersonation binding, and bootstrap IAM role once from an existing project administrator session before the first run. These are authentication prerequisites only; the bucket and managed folders remain workflow-owned.

Require reviewers on `infra-bootstrap`. The WIF principal must be allowed to impersonate the configured service account. That service account needs `storage.buckets.create`, `storage.buckets.get`, `storage.buckets.update`, `storage.buckets.setIamPolicy`, `storage.managedFolders.create`, and `storage.managedFolders.get` in the state project. Prefer a bootstrap-specific custom role; if `roles/storage.admin` is granted temporarily, revoke it after the first successful run. Do not store a service-account JSON key in GitHub.

After this workflow is merged to the default branch, run it from the Actions screen on `main` with confirmation `bootstrap-kagami-infra`, or use:

```bash
gh workflow run setup-pulumi-state.yml --ref main \
  -f confirmation=bootstrap-kagami-infra
```

The workflow performs the equivalent of this initial construction procedure. Keep these commands as the break-glass manual reference; normal setup uses the workflow.

```bash
gcloud storage buckets create gs://kagami-infra \
  --default-storage-class=STANDARD \
  --location=ASIA \
  --uniform-bucket-level-access \
  --public-access-prevention
gcloud storage buckets update gs://kagami-infra --versioning
gcloud storage managed-folders create gs://kagami-infra/kagami/cloudflare/
gcloud storage managed-folders create gs://kagami-infra/kagami/gcp-platform/
```

Managed folders `kagami/cloudflare/` and `kagami/gcp-platform/` provide IAM boundaries for each state prefix.

The backend URLs are fixed in each `Pulumi.yaml`; callers do not select them at runtime. A conflicting `PULUMI_BACKEND_URL` is rejected. Separate managed folders and passphrases prevent the Preview CI principal from reading, replacing, or deleting GCP application state.

No GCP service-account JSON key is required or accepted for this procedure. Keep these credentials outside Git:

| Operation | Required credential |
| --- | --- |
| state backend bootstrap workflow | GitHub OIDC / Workload Identity Federation; no JSON key |
| break-glass manual bucket operation | the interactive `gcloud auth login` session |
| local Pulumi state and GCP operations | ADC from `gcloud auth application-default login` |
| Pulumi state decryption | a user-generated `PULUMI_CONFIG_PASSPHRASE`; use different values for Cloudflare and GCP |
| Cloudflare resource operations | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` |
| GitHub Actions state access | OIDC / Workload Identity Federation; no JSON key |

```bash
export PULUMI_CONFIG_PASSPHRASE=<cloudflare-value-from-password-manager>
pulumi login gs://kagami-infra/kagami/cloudflare
```

For local operations, `gcloud auth application-default login` supplies credentials for the GCS backend. The operator must have access to the relevant managed folder and the cloud resources being managed. Do not create a service-account JSON key.

The `Reset / Preview Migrations` workflow authenticates with GitHub OIDC and Workload Identity Federation. Configure these GitHub Actions values at repository level or in Environment `dev` before running it:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `PULUMI_CONFIG_PASSPHRASE` | the non-empty passphrase for the Cloudflare Stack |
| Variable | `GCP_STATE_PROJECT_ID` | the project that owns `gs://kagami-infra/` |
| Variable | `GCP_WORKLOAD_IDENTITY_PROVIDER` | the full Workload Identity Provider resource name restricted to this repository |
| Variable | `GCP_PULUMI_STATE_SERVICE_ACCOUNT` | the service account impersonated by GitHub Actions |

The Workload Identity principal must be allowed to impersonate only the configured service account. Grant that service account object access on the `kagami/cloudflare/` managed folder, not at bucket level, and do not grant it access to `kagami/gcp-platform/`. The workflow does not accept a JSON key fallback.

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
