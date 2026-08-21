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

Pulumi authenticates its infrastructure operations with Google Application Default Credentials (ADC); this is separate from the runtime API keys created by the Stack. For local setup, run `gcloud auth application-default login` with an operator that has the permissions described below. Do not create or commit a service-account JSON key for local deployment. If these Stacks are automated in CI later, use OIDC / Workload Identity Federation and short-lived credentials instead of a stored JSON key.

## State backend and first deployment

The existing state project, GCP platform state bucket, required bucket controls, and local ADC are defined by the parent [infrastructure state backend guide](../README.md#state-backend). This project does not create its own backend and does not share a bucket or passphrase with the Cloudflare project. The repository wrapper and Pulumi program require a `gs://` backend and a non-empty `PULUMI_CONFIG_PASSPHRASE` before evaluating resources. This prevents the OAuth Client Secret from entering local state or state encrypted with an empty passphrase.

Application project IDs are globally unique. Use different values for the two Stacks and connect both to the same Billing Account used by Vertex AI. The projects must belong to an organization, directly or through a folder, because Google does not support service-account-bound authorization keys for projects without an organization.

```bash
export PULUMI_BACKEND_URL=gs://<existing-gcp-platform-state-bucket>/me-builder
export PULUMI_CONFIG_PASSPHRASE=<gcp-platform-value-from-password-manager>
pulumi login "$PULUMI_BACKEND_URL"

pulumi -C infra/gcp-platform stack init development
pulumi -C infra/gcp-platform config set projectId <development-project-id> --stack development
pulumi -C infra/gcp-platform config set projectName "me-builder platform development" --stack development
pulumi -C infra/gcp-platform config set billingAccount <billing-account-id> --stack development
pulumi -C infra/gcp-platform config set organizationId <organization-id> --stack development
task infra:gcp-platform:preview:development
ALLOW_GCP_PLATFORM_UP=development task infra:gcp-platform:up:development

pulumi -C infra/gcp-platform stack init production
pulumi -C infra/gcp-platform config set projectId <production-project-id> --stack production
pulumi -C infra/gcp-platform config set projectName "me-builder platform production" --stack production
pulumi -C infra/gcp-platform config set billingAccount <billing-account-id> --stack production
pulumi -C infra/gcp-platform config set organizationId <organization-id> --stack production
task infra:gcp-platform:preview:production
ALLOW_GCP_PLATFORM_UP=production task infra:gcp-platform:up:production
```

The checked-in starting limits are USD 10/month for Development and USD 50/month for Production. `budgetCurrencyCode` must match the Billing Account currency. Change it together with `monthlyBudgetAmount` and `vertexSpendCapAmount` in the reviewed Stack YAML before the first update when the account uses another currency or these are not the intended limits.

The first update intentionally leaves Vertex runtime authorization keys absent. After it, complete these two manual Google Cloud controls in each project:

1. Open Google Auth Platform, configure its consent screen, and create the environment's Web application client with the callback URIs in the Stack YAML.
2. Open Cloud Billing Budgets & alerts, create a service spend cap for Vertex AI on this project, and set it to exactly the Stack's `vertexSpendCapAmount` in `budgetCurrencyCode`. A normal Pulumi-managed budget only sends alerts; it does not stop usage. Google's spend cap is currently Preview and is not exposed by the public Cloud Billing Budget API or the Pulumi GCP provider.

Then complete each Stack. The confirmation config is an operator attestation; it must not be set before the Cloud Console spend cap exists.

```bash
pulumi -C infra/gcp-platform config set googleOAuthClientId <development-web-client-id> --stack development
pulumi -C infra/gcp-platform config set --secret googleOAuthClientSecret <development-web-client-secret> --stack development
pulumi -C infra/gcp-platform config set vertexSpendCapConfirmed true --stack development
pulumi -C infra/gcp-platform config set vertexRuntimeCredentialsEnabled true --stack development
task infra:gcp-platform:preview:development
ALLOW_GCP_PLATFORM_UP=development task infra:gcp-platform:up:development

pulumi -C infra/gcp-platform config set googleOAuthClientId <production-web-client-id> --stack production
pulumi -C infra/gcp-platform config set --secret googleOAuthClientSecret <production-web-client-secret> --stack production
pulumi -C infra/gcp-platform config set vertexSpendCapConfirmed true --stack production
pulumi -C infra/gcp-platform config set vertexRuntimeCredentialsEnabled true --stack production
task infra:gcp-platform:preview:production
ALLOW_GCP_PLATFORM_UP=production task infra:gcp-platform:up:production
```

Use `folderId` instead of `organizationId` when the projects belong under a folder. Project creation requires Project Creator and Billing Account User. The deploy principal also needs permission to manage project organization policies. Pulumi explicitly enforces Google's block on service-account-bound API keys while runtime credentials are disabled, switches only this project to an exception when they are enabled, and leaves the parent policy unchanged.

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

From the repository root, use the scripts exposed by the parent infrastructure package:

```bash
task infra:gcp-platform:preview:development
ALLOW_GCP_PLATFORM_UP=development task infra:gcp-platform:up:development
task infra:gcp-platform:preview:production
ALLOW_GCP_PLATFORM_UP=production task infra:gcp-platform:up:production
```

Both projects and their Identity Platform, IAM, organization policy, and budget configuration are protected from Pulumi deletion. Rotatable API keys deliberately are not protected. An intentional foundation teardown requires a separate reviewed change that removes both Pulumi `protect` and the GCP `PREVENT` deletion policies.
