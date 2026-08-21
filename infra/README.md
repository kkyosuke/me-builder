# Infrastructure

`infra/` contains two independent Pulumi projects:

- the root project manages the Cloudflare D1 database, private avatar R2 bucket, KV namespace, and Queue resources
- [`gcp-platform/`](./gcp-platform/) manages Identity Platform and Vertex AI resources inside separate existing development and production GCP projects

Wrangler still deploys Worker bundles, secrets, bindings, and Durable Object migrations. The ownership boundary and deletion order are defined in [the infrastructure architecture](../docs/architecture/infrastructure-architecture.md#61-cloudflareリソースの宣言とデプロイ境界).

## Requirements

- Pulumi CLI
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` with D1, R2, Queues, and Workers Scripts edit permissions
- an existing Google Cloud state project and manually configured `gs://kagami-infra/` bucket
- a non-empty `PULUMI_CONFIG_PASSPHRASE`, supplied from a password manager locally and from GitHub Secrets in CI

The GCP platform project additionally requires existing application projects with Cloud Billing already connected, Application Default Credentials, project read access, and permission to manage the child resources declared by its Stack. It never creates or updates the application project itself. See its [setup guide](./gcp-platform/README.md).

## One-time state backend bootstrap

The state project, `gs://kagami-infra/` bucket, and its managed folders are manual prerequisites. No repository workflow creates, updates, or deletes them. Run the following once from an interactive project administrator session:

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

GitHub Actions uses Direct Workload Identity Federation and does not impersonate a service account. Repository-only trust is not sufficient because a different workflow in the same repository could request an ID token. Map the immutable repository ID, workflow reference, and Environment, then restrict the Provider to the reviewed workflows on `main`:

```bash
gcloud iam workload-identity-pools providers update-oidc github-actions-provider \
  --project=gen-lang-client-0647422425 \
  --location=global \
  --workload-identity-pool=github-actions \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.workflow_ref=assertion.workflow_ref,attribute.environment=assertion.environment" \
  --attribute-condition="assertion.repository_id=='1309307514' && assertion.ref=='refs/heads/main' && ((assertion.workflow_ref.endsWith('/.github/workflows/deploy-gcp-platform.yml@refs/heads/main') && assertion.environment in ['infra-dev', 'infra-prd']) || (assertion.workflow_ref.endsWith('/.github/workflows/reset-preview-migrations.yml@refs/heads/main') && assertion.environment=='dev'))"
```

Grant state access by mapped Environment so the GCP platform and Cloudflare workflows cannot cross-read each other's Pulumi state:

```text
principalSet://iam.googleapis.com/projects/719104396651/locations/global/workloadIdentityPools/github-actions/attribute.environment/infra-dev
principalSet://iam.googleapis.com/projects/719104396651/locations/global/workloadIdentityPools/github-actions/attribute.environment/infra-prd
principalSet://iam.googleapis.com/projects/719104396651/locations/global/workloadIdentityPools/github-actions/attribute.environment/dev
```

`principal://.../attribute.environment/...` is invalid: `principal://` is only for one mapped `subject`, while a mapped attribute requires `principalSet://`. Grant `roles/storage.objectAdmin` to `infra-dev` and `infra-prd` only on `kagami/gcp-platform/`, and grant it to `dev` only on `kagami/cloudflare/`. Remove the former bucket-level `attribute.repository/kkyosuke/me-builder` binding after these bindings are verified. No GitHub Actions principal needs `storage.buckets.create`, `storage.buckets.update`, or `storage.buckets.setIamPolicy`. Do not create or store a service-account JSON key.

Managed folders `kagami/cloudflare/` and `kagami/gcp-platform/` provide IAM boundaries for each state prefix.

The backend URLs are fixed in each `Pulumi.yaml`; callers do not select them at runtime. A conflicting `PULUMI_BACKEND_URL` is rejected. Separate managed folders and passphrases prevent the Preview CI principal from reading, replacing, or deleting GCP application state.

No GCP service-account JSON key is required or accepted for this procedure. Keep these credentials outside Git:

| Operation | Required credential |
| --- | --- |
| one-time state backend bootstrap | the interactive `gcloud auth login` session |
| local Pulumi state and GCP operations | ADC from `gcloud auth application-default login` |
| Pulumi state decryption | a user-generated `PULUMI_CONFIG_PASSPHRASE`; use different values for Cloudflare and GCP |
| Cloudflare resource operations | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` |
| GitHub Actions state access | OIDC / Direct Workload Identity Federation; no service account or JSON key |

```bash
export PULUMI_CONFIG_PASSPHRASE=<cloudflare-value-from-password-manager>
pulumi login gs://kagami-infra/kagami/cloudflare
```

For local operations, `gcloud auth application-default login` supplies credentials for the GCS backend. The operator must have access to the relevant managed folder and the cloud resources being managed. Do not create a service-account JSON key.

The `Reset / Preview Migrations` workflow first requires approval through `infra-dev`, then authenticates from its `dev` job with GitHub OIDC and Workload Identity Federation. It runs only from the reviewed `main` workflow. Configure these GitHub Actions values in Environment `dev` before running it:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `PULUMI_CONFIG_PASSPHRASE` | the non-empty passphrase for the Cloudflare Stack |
| Variable | `GCP_STATE_PROJECT_ID` | the project that owns `gs://kagami-infra/` |
| Secret | `GCP_WORKLOAD_IDENTITY_PROVIDER` | the full Workload Identity Provider resource name restricted to this repository and Environment |

Grant the direct Workload Identity principal object access on the `kagami/cloudflare/` managed folder, not at bucket level, and do not grant it access to `kagami/gcp-platform/`. The workflows do not accept a service-account or JSON-key fallback.

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

The `Reset / Preview Migrations` manual workflow performs the clean recreation and application redeployment only from reviewed `main`, after `infra-dev` approval. Because recreation changes Cloudflare resource IDs, the workflow opens a dedicated PR containing the updated manifest and generated TOML files, verifies it, and merges it when verification succeeds. Normal Preview CD runs `infra:preview:sync` before migrations so deployment remains valid while generated changes are awaiting merge.
