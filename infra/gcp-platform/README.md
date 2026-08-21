# GCP platform infrastructure

This Pulumi project creates the Google Cloud foundation used by me-builder authentication and Vertex AI. It is intentionally separate from the Cloudflare Pulumi project so the `development` and `production` GCP projects have independent state and lifecycle.

## Managed resources

- environment-specific GCP project connected to the configured Cloud Billing account
- Service Usage, API Keys, IAM, Organization Policy, Billing Budgets, Identity Toolkit, and Vertex AI APIs
- Identity Platform project configuration with anonymous, email/password, and phone sign-in disabled
- Google as the enabled Identity Platform provider
- rotatable API key slots restricted to Identity Platform `SignInWithIdp`
- Vertex AI API
- a dedicated Vertex AI service account with a custom inference-only role and Service Usage Consumer
- rotatable service-account-bound authorization key slots restricted to `GenerateContent` and `EmbedContent`
- a gross-cost monthly project budget with alerts at 50%, 80%, and 100%
- a fail-closed gate that keeps Vertex runtime credentials absent until its service spend cap is confirmed

Google Auth Platform owns the OAuth consent screen and Web OAuth client. Google requires the general-purpose user sign-in client and its consent configuration to be created manually in Cloud Console; the Pulumi GCP resources do not manage it. Create one client per Stack and pass its ID and secret to Pulumi. Do not substitute an IAP or workload OAuth client: those are different products, and the Pulumi IAP client resource is deprecated. When client credentials are not configured yet, Pulumi creates the project and Identity Platform foundation but intentionally leaves the Google provider absent.

The development client must contain both callback URIs listed in `Pulumi.development.yaml`. The production client must contain only the production callback in `Pulumi.production.yaml`.

## GCP deploy authentication

The manual `Deploy / GCP Platform` GitHub Actions workflow authenticates with GitHub OIDC and Direct Workload Identity Federation. It uses short-lived credentials and does not impersonate a service account or accept a service-account JSON key. Local Pulumi operations use Google Application Default Credentials (ADC) from `gcloud auth application-default login`; this is separate from the runtime API keys created by the Stack.

## State backend and first deployment

The existing state project, `gs://kagami-infra/` bucket, required bucket controls, and local ADC are defined by the parent [infrastructure state backend guide](../README.md#one-time-state-backend-bootstrap). This project uses the dedicated `kagami/gcp-platform/` managed folder and does not share a passphrase or IAM access with the Cloudflare project. The repository wrapper and Pulumi program require a non-empty `PULUMI_CONFIG_PASSPHRASE` before evaluating resources and reject any runtime backend override that differs from `Pulumi.yaml`. This prevents the OAuth Client Secret from entering local state or state encrypted with an empty passphrase.

Application project IDs are globally unique. Use different values for the two Stacks and connect both to the same Billing Account used by Vertex AI. Organization and folder parents are optional. When neither is configured, the standalone project must already exist; Pulumi imports that project and manages it from then on without changing its existing network configuration. Direct WIF identities cannot create standalone projects.

Google does not support changing the policy required for service-account-bound authorization keys on a project without an organization. A standalone project can deploy Identity Platform, its restricted API key, the budget, Vertex AI API, and the Vertex runtime service account, but `vertexRuntimeCredentialsEnabled` must remain `false`. This is a fail-closed limitation: do not replace it with an unbound Vertex API key without a separate security review.

### GitHub Actions deployment

Configure the approval-protected GitHub Environments `infra-dev` and `infra-prd`. Each Environment owns only its matching Stack values.

| Kind | Name | Requirement |
| --- | --- | --- |
| Variable | `GCP_STATE_PROJECT_ID` | Existing project that owns `gs://kagami-infra/` |
| Variable | `GCP_PLATFORM_PROJECT_ID` | Globally unique application project ID for the Stack |
| Variable | `GCP_PLATFORM_PROJECT_NAME` | Optional display name; defaults from the Stack environment |
| Variable | `GCP_BILLING_ACCOUNT` | Billing Account ID attached to the application project |
| Variable | `GCP_ORGANIZATION_ID` | Optional Organization parent; do not combine with `GCP_FOLDER_ID` |
| Variable | `GCP_FOLDER_ID` | Optional Folder parent; do not combine with `GCP_ORGANIZATION_ID` |
| Variable | `GOOGLE_OAUTH_CLIENT_ID` | Optional until the manual Web OAuth client has been created |
| Secret | `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full Workload Identity Provider resource name |
| Secret | `PULUMI_CONFIG_PASSPHRASE` | Stack-specific non-empty state encryption passphrase |
| Secret | `GOOGLE_OAUTH_CLIENT_SECRET` | Required together with `GOOGLE_OAUTH_CLIENT_ID` |

The WIF principal needs object administration only on the `kagami/gcp-platform/` managed folder for state. For an Organization or Folder deployment, separately grant its deployment identity Project Creator on that parent and Billing Account User on the Billing Account. For a standalone deployment, create the project manually first and grant the WIF principal the IAM, Service Usage, API Keys, Identity Platform, Budget, billing-project update, and service-account permissions required by this Pulumi program on that project; no Project Creator role is used. Keep Development and Production bindings separate. Organization Policy permission is required only for the authorization-key path available to Organization or Folder projects.

Run [`deploy-gcp-platform.yml`](../../.github/workflows/deploy-gcp-platform.yml) from reviewed `main`. Choose `preview` or `apply`, choose the Stack, and enter the exact confirmation shown by the workflow. `apply` calls the repository's guarded `gcp-platform:up` command only after the matching GitHub Environment approval.

The workflow creates the Pulumi Stack when it does not exist and reconstructs its environment-specific configuration before every operation. OAuth client ID and secret must either both be present or both be absent. Their absence is supported only for the first foundation deployment.

### Local deployment

```bash
export PULUMI_CONFIG_PASSPHRASE=<gcp-platform-value-from-password-manager>
pulumi login gs://kagami-infra/kagami/gcp-platform

pulumi -C infra/gcp-platform stack init development
pulumi -C infra/gcp-platform config set projectId <development-project-id> --stack development
pulumi -C infra/gcp-platform config set projectName "me-builder platform development" --stack development
pulumi -C infra/gcp-platform config set billingAccount <billing-account-id> --stack development
task infra:gcp-platform:preview:development
ALLOW_GCP_PLATFORM_UP=development task infra:gcp-platform:up:development

pulumi -C infra/gcp-platform stack init production
pulumi -C infra/gcp-platform config set projectId <production-project-id> --stack production
pulumi -C infra/gcp-platform config set projectName "me-builder platform production" --stack production
pulumi -C infra/gcp-platform config set billingAccount <billing-account-id> --stack production
task infra:gcp-platform:preview:production
ALLOW_GCP_PLATFORM_UP=production task infra:gcp-platform:up:production
```

These local commands show the standalone-project path and require each project to exist before they run. For a project under an Organization or Folder, set `organizationId` or `folderId` respectively before preview; Pulumi then creates the project instead of importing it.

The checked-in starting limits are USD 10/month for Development and USD 50/month for Production. `budgetCurrencyCode` must match the Billing Account currency. Change it together with `monthlyBudgetAmount` and `vertexSpendCapAmount` in the reviewed Stack YAML before the first update when the account uses another currency or these are not the intended limits.

The first update intentionally leaves Vertex runtime authorization keys absent. After it, complete these two manual Google Cloud controls in each project:

1. Open Google Auth Platform, configure its consent screen, and create the environment's Web application client with the callback URIs in the Stack YAML.
2. Open Cloud Billing Budgets & alerts, create a service spend cap for Vertex AI on this project, and set it to exactly the Stack's `vertexSpendCapAmount` in `budgetCurrencyCode`. A normal Pulumi-managed budget only sends alerts; it does not stop usage. Google's spend cap is currently Preview and is not exposed by the public Cloud Billing Budget API or the Pulumi GCP provider.

Then configure the Google provider in each Stack. The spend-cap confirmation is an operator attestation; it must not be set before the Cloud Console spend cap exists. Enable Vertex runtime credentials only for an Organization or Folder project.

```bash
pulumi -C infra/gcp-platform config set googleOAuthClientId <development-web-client-id> --stack development
pulumi -C infra/gcp-platform config set --secret googleOAuthClientSecret <development-web-client-secret> --stack development
pulumi -C infra/gcp-platform config set vertexSpendCapConfirmed true --stack development
task infra:gcp-platform:preview:development
ALLOW_GCP_PLATFORM_UP=development task infra:gcp-platform:up:development

pulumi -C infra/gcp-platform config set googleOAuthClientId <production-web-client-id> --stack production
pulumi -C infra/gcp-platform config set --secret googleOAuthClientSecret <production-web-client-secret> --stack production
pulumi -C infra/gcp-platform config set vertexSpendCapConfirmed true --stack production
task infra:gcp-platform:preview:production
ALLOW_GCP_PLATFORM_UP=production task infra:gcp-platform:up:production
```

For an Organization or Folder project only, set `vertexRuntimeCredentialsEnabled` to `true` after the spend cap is confirmed and apply again. Project creation requires Project Creator and Billing Account User. The deploy principal also needs permission to manage project organization policies. Pulumi explicitly enforces Google's block on service-account-bound API keys while runtime credentials are disabled. When enabled, the constraint remains enforced and its `allowedServices` parameter permits only `aiplatform.googleapis.com`; it does not open authorization-key creation for other services and leaves the parent policy unchanged.

The `platform` Stack output contains the active keys as Pulumi secrets. Copy `identityPlatformApiKey` to `GOOGLE_IDENTITY_PLATFORM_API_KEY`, copy `vertexAiApiKey` to `GOOGLE_VERTEX_AI_API_KEY`, copy the client ID to `GOOGLE_OAUTH_CLIENT_ID`, and distribute the original client secret as `GOOGLE_OAUTH_CLIENT_SECRET` in the matching GitHub Environment. Never print secret outputs in CI logs. `vertexAiApiKey` remains absent until both spend-cap configs are true.

The Vertex AI key is bound to the Stack's dedicated service account, not an unbound standard API key. The Worker continues to keep the value only in its server-side secret binding. API method restrictions limit the key to generation and embedding, while the custom IAM role grants only `aiplatform.endpoints.predict`. Cloudflare Workers do not have stable outbound IP addresses, so this Stack cannot add the only supported application restriction for authorization keys, an IP allowlist.

## Credential rotation

Keys use `primary` and `secondary` slots, but only the active slot exists during normal operation. To rotate without downtime:

1. Change the inactive slot under `credentialGenerations` from `null` to a new generation (for example, `v2`) and apply the Stack.
2. Retrieve that inactive slot locally from the secret `identityPlatformApiKeys` or `vertexAiApiKeys` output. Do not expose it in CI logs.
3. Test the new Development key, distribute it to the matching GitHub Environment, and verify text generation and embedding.
4. Change `activeCredentialSlot` to the new slot and apply.
5. After a short rollback window, set the old slot's generation to `null` and apply to delete that key. Rotate Production separately after the Development gate.

## Updates

Use the manual `Deploy / GCP Platform` workflow for normal reviewed updates. For local break-glass operations, use the scripts exposed by the parent infrastructure package:

```bash
task infra:gcp-platform:preview:development
ALLOW_GCP_PLATFORM_UP=development task infra:gcp-platform:up:development
task infra:gcp-platform:preview:production
ALLOW_GCP_PLATFORM_UP=production task infra:gcp-platform:up:production
```

Both projects and their Identity Platform, IAM, optional organization policy, and budget configuration are protected from Pulumi deletion. Rotatable API keys deliberately are not protected. An intentional foundation teardown requires a separate reviewed change that removes both Pulumi `protect` and the GCP `PREVENT` deletion policies.
