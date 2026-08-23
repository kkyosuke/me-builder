# GCP platform infrastructure

This Pulumi project creates the Google Cloud resources used by me-builder authentication and Vertex AI inside existing application projects. It is intentionally separate from the Cloudflare Pulumi project so the `development` and `production` resources have independent state and lifecycle.

## Managed resources

- validation of an existing environment-specific GCP project and its preconfigured Cloud Billing connection, without managing the project itself
- API activation declared under the [API activation boundary](#api-activation-boundary)
- Identity Platform project configuration with anonymous, email/password, and phone sign-in disabled
- Google as the enabled Identity Platform provider
- rotatable API key slots restricted to Identity Platform `SignInWithIdp`
- Vertex AI API
- a dedicated Vertex AI service account with a custom inference-only role and Service Usage Consumer
- rotatable service-account-bound authorization key slots restricted to `GenerateContent` and `EmbedContent`
- a gross-cost monthly project budget with alerts at 50%, 80%, and 100%
- a fail-closed gate that keeps Vertex runtime credentials absent until its service spend cap is confirmed

Google Auth Platform registration and the Web OAuth client are one-time manual prerequisites. The detailed boundary and environment-specific values are defined under [State backend and first deployment](#state-backend-and-first-deployment).

## GCP deploy authentication

The manual `Deploy / GCP Platform` GitHub Actions workflow authenticates with GitHub OIDC and Direct Workload Identity Federation. It uses short-lived credentials and does not impersonate a service account or accept a service-account JSON key. Local Pulumi operations use Google Application Default Credentials (ADC) from `gcloud auth application-default login`; this is separate from the runtime API keys created by the Stack.

## State backend and first deployment

The existing state project, `gs://kagami-infra/` bucket, required bucket controls, and local ADC are defined by the parent [infrastructure state backend guide](../README.md#one-time-state-backend-bootstrap). This project uses the dedicated `kagami/gcp-platform/` managed folder and does not share a passphrase or IAM access with the Cloudflare project. The repository wrapper and Pulumi program require a non-empty `PULUMI_CONFIG_PASSPHRASE` before evaluating resources and reject any runtime backend override that differs from `Pulumi.yaml`. This prevents the OAuth Client Secret from entering local state or state encrypted with an empty passphrase.

### One-time manual prerequisites per application project

Complete the following bootstrap once for each Development and Production application project before its first Pulumi operation. These resources require human ownership or must exist before the GCP provider can evaluate the Stack, so they intentionally remain outside Pulumi.

```mermaid
flowchart LR
    Project[Create GCP project] --> Billing[Connect Cloud Billing]
    Billing --> ServiceUsage[Enable Service Usage API]
    ServiceUsage --> OAuth[Register Google Auth app and Web client]
    OAuth --> Environment[Store values in GitHub Environment]
    Environment --> Pulumi[Pulumi preview and apply]
```

1. Create the application project. For a personal standalone project, do not set an Organization or Folder parent. Development and Production must use different project IDs.
2. Connect the intended Cloud Billing Account to the project. Pulumi validates this association but never creates, changes, unlinks, or deletes it.
3. Enable only Service Usage API (`serviceusage.googleapis.com`) manually. The provider must call this API before it can read or create any `gcp.projects.Service`, so the Pulumi resource cannot bootstrap the API that it depends on.
4. Register the project in Google Auth Platform and create its Web OAuth client using the environment-specific settings below.
5. Complete the [Direct WIF and state backend setup](../README.md#one-time-state-backend-bootstrap), then configure the matching approval-protected GitHub Environment as described under [GitHub Actions deployment](#github-actions-deployment).

The equivalent `gcloud` commands for steps 1 through 3 are:

```bash
GCP_APPLICATION_PROJECT_ID="replace-with-application-project-id"
GCP_APPLICATION_PROJECT_NAME="replace-with-application-project-name"
GCP_BILLING_ACCOUNT_ID="replace-with-billing-account-id"

gcloud projects create "${GCP_APPLICATION_PROJECT_ID}" \
  --name="${GCP_APPLICATION_PROJECT_NAME}"
gcloud billing projects link "${GCP_APPLICATION_PROJECT_ID}" \
  --billing-account="${GCP_BILLING_ACCOUNT_ID}"
gcloud services enable serviceusage.googleapis.com \
  --project="${GCP_APPLICATION_PROJECT_ID}"
```

Skip project creation when the intended project already exists. Running the Service Usage command again is safe; it converges on the enabled state.

#### Google Auth Platform and Web OAuth client

In Google Cloud Console, select the application project and open Google Auth Platform. Register the app before creating a client. The Development app can remain in testing while access is limited to explicitly registered test users. The requested scopes and the reason email is excluded are defined by the [Web authentication design](../../docs/architecture/web-authentication-design.md#92-transactionとtoken検証).

Create a client with application type **Web application**. This server-side flow does not require an Authorized JavaScript origin. Register the callback values from [`Pulumi.development.yaml`](./Pulumi.development.yaml) or [`Pulumi.production.yaml`](./Pulumi.production.yaml) as Authorized redirect URIs with exact matching and without wildcards. Their environment ownership is defined by the [Web authentication design](../../docs/architecture/web-authentication-design.md#93-環境とurl).

Save the Client Secret when the creation dialog displays it. Store the Client ID as `GOOGLE_OAUTH_CLIENT_ID` and the Client Secret as `GOOGLE_OAUTH_CLIENT_SECRET` in the matching `infra-dev` or `infra-prd` GitHub Environment. Pulumi then creates the Identity Platform Google provider from those inputs; it does not own the Google Auth Platform client itself.

#### API activation boundary

Only Service Usage API is a manual prerequisite. It remains declared by the Stack so the first successful Apply records it in Pulumi state together with the other service resources. Do not manually enable the remaining APIs just to prepare a new project.

| Owner | API | Service name |
| --- | --- | --- |
| Manual bootstrap, then Pulumi | Service Usage API | `serviceusage.googleapis.com` |
| Pulumi | Cloud Billing API | `cloudbilling.googleapis.com` |
| Pulumi | Cloud Billing Budget API | `billingbudgets.googleapis.com` |
| Pulumi | API Keys API | `apikeys.googleapis.com` |
| Pulumi | Identity Toolkit API | `identitytoolkit.googleapis.com` |
| Pulumi | Identity and Access Management API | `iam.googleapis.com` |
| Pulumi | Organization Policy API | `orgpolicy.googleapis.com` |
| Pulumi | Vertex AI API | `aiplatform.googleapis.com` |

Pulumi reads and validates the existing project but never creates, imports, updates, moves, unlinks, or deletes it. Project name, labels, network configuration, and Cloud Billing connection therefore remain outside this Stack. The Stack enables the Cloud Billing API before reading and validating the manual billing connection; a first preview keeps the deferred billing read unknown until Apply. Use different project IDs for the two Stacks.

Google does not support changing the policy required for service-account-bound authorization keys on a project without an organization. A standalone project can deploy Identity Platform, its restricted API key, the budget, Vertex AI API, and the Vertex runtime service account, but `vertexRuntimeCredentialsEnabled` must remain `false`. This is a fail-closed limitation: do not replace it with an unbound Vertex API key without a separate security review.

### GitHub Actions deployment

Configure the approval-protected GitHub Environments `infra-dev` and `infra-prd`. Each Environment owns only its matching Stack values.

| Kind | Name | Requirement |
| --- | --- | --- |
| Variable | `GCP_STATE_PROJECT_ID` | Existing project that owns `gs://kagami-infra/` |
| Variable | `GCP_PLATFORM_PROJECT_ID` | Globally unique application project ID for the Stack |
| Variable | `GCP_BILLING_ACCOUNT` | Billing Account ID attached to the application project |
| Variable | `GCP_ORGANIZATION_ID` | Optional Organization parent; do not combine with `GCP_FOLDER_ID` |
| Variable | `GCP_FOLDER_ID` | Optional Folder parent; do not combine with `GCP_ORGANIZATION_ID` |
| Variable | `GOOGLE_OAUTH_CLIENT_ID` | Web OAuth Client ID created during manual bootstrap |
| Secret | `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full Workload Identity Provider resource name |
| Secret | `PULUMI_CONFIG_PASSPHRASE` | Stack-specific non-empty state encryption passphrase |
| Secret | `GOOGLE_OAUTH_CLIENT_SECRET` | Web OAuth Client Secret saved during manual bootstrap |

The WIF principal needs object administration only on the `kagami/gcp-platform/` managed folder for state. On its existing application project, grant Browser, Service Usage Admin, API Keys Admin, Identity Platform Admin, Service Account Admin, Role Admin, and Project IAM Admin. Grant Billing Account Costs Manager on the configured Billing Account so the Stack can manage its budget. Project Creator, Project Mover, Project Billing Manager, and Billing Account User are not required because the Stack does not mutate the project or its billing association. Keep Development and Production bindings separate. Organization Policy Administrator and Service Account API Key Binding Admin are required only for the authorization-key path available to Organization or Folder projects.

| Scope | Role ID | Purpose |
| --- | --- | --- |
| application project | `roles/browser` | read the existing project, number, billing association, and parent |
| application project | `roles/serviceusage.serviceUsageAdmin` | enable and inspect declared APIs |
| application project | `roles/serviceusage.apiKeysAdmin` | manage restricted Identity Platform API keys |
| application project | `roles/identityplatform.admin` | manage Identity Platform configuration and Google provider |
| application project | `roles/iam.serviceAccountAdmin` | manage the dedicated Vertex runtime service account |
| application project | `roles/iam.roleAdmin` | manage the inference-only custom role |
| application project | `roles/resourcemanager.projectIamAdmin` | bind the custom role and Service Usage Consumer to the runtime service account |
| Billing Account | `roles/billing.costsManager` | manage the Pulumi-declared project budget |
| Organization or Folder project only | `roles/orgpolicy.policyAdmin` | manage the service-account-bound authorization-key policy |
| Organization or Folder project only | `roles/iam.serviceAccountApiKeyBindingAdmin` | bind a Vertex authorization key to the runtime service account |

Run [`deploy-gcp-platform.yml`](../../.github/workflows/deploy-gcp-platform.yml) from reviewed `main`. Choose `preview` or `apply`, choose the Stack, and enter the exact confirmation shown by the workflow. `apply` calls the repository's guarded `gcp-platform:up` command only after the matching GitHub Environment approval.

The workflow creates the Pulumi Stack when it does not exist and reconstructs its environment-specific configuration before every operation. OAuth client ID and secret are required from the first operation so a successful first Apply always includes the Identity Platform Google provider.

### Local deployment

```bash
export PULUMI_CONFIG_PASSPHRASE=<gcp-platform-value-from-password-manager>
pulumi login gs://kagami-infra/kagami/gcp-platform

pulumi -C infra/gcp-platform stack init development
pulumi -C infra/gcp-platform config set projectId <development-project-id> --stack development
pulumi -C infra/gcp-platform config set billingAccount <billing-account-id> --stack development
pulumi -C infra/gcp-platform config set googleOAuthClientId <development-web-client-id> --stack development
pulumi -C infra/gcp-platform config set --secret googleOAuthClientSecret <development-web-client-secret> --stack development
task infra:gcp-platform:preview:development
ALLOW_GCP_PLATFORM_UP=development task infra:gcp-platform:up:development

pulumi -C infra/gcp-platform stack init production
pulumi -C infra/gcp-platform config set projectId <production-project-id> --stack production
pulumi -C infra/gcp-platform config set billingAccount <billing-account-id> --stack production
pulumi -C infra/gcp-platform config set googleOAuthClientId <production-web-client-id> --stack production
pulumi -C infra/gcp-platform config set --secret googleOAuthClientSecret <production-web-client-secret> --stack production
task infra:gcp-platform:preview:production
ALLOW_GCP_PLATFORM_UP=production task infra:gcp-platform:up:production
```

These commands require each project and its Cloud Billing connection to exist before they run. For a project under an Organization or Folder, set its existing `organizationId` or `folderId` before preview. Pulumi verifies that the configured project, billing account, and parent match GCP and fails without changing them when they differ.

The checked-in starting limits are USD 10/month for Development and USD 50/month for Production. `budgetCurrencyCode` must match the Billing Account currency. Change it together with `monthlyBudgetAmount` and `vertexSpendCapAmount` in the reviewed Stack YAML before the first update when the account uses another currency or these are not the intended limits.

The first update intentionally leaves Vertex runtime authorization keys absent. After it, complete this additional manual Google Cloud control in each project:

1. Open Cloud Billing Budgets & alerts, create a service spend cap for Vertex AI on this project, and set it to exactly the Stack's `vertexSpendCapAmount` in `budgetCurrencyCode`. A normal Pulumi-managed budget only sends alerts; it does not stop usage. Google's spend cap is currently Preview and is not exposed by the public Cloud Billing Budget API or the Pulumi GCP provider.

The spend-cap confirmation is an operator attestation; it must not be set before the Cloud Console spend cap exists. Record it in each Stack after creating the cap. Enable Vertex runtime credentials only for an Organization or Folder project.

```bash
pulumi -C infra/gcp-platform config set vertexSpendCapConfirmed true --stack development
task infra:gcp-platform:preview:development
ALLOW_GCP_PLATFORM_UP=development task infra:gcp-platform:up:development

pulumi -C infra/gcp-platform config set vertexSpendCapConfirmed true --stack production
task infra:gcp-platform:preview:production
ALLOW_GCP_PLATFORM_UP=production task infra:gcp-platform:up:production
```

For an Organization or Folder project only, set `vertexRuntimeCredentialsEnabled` to `true` after the spend cap is confirmed and apply again. The deploy principal also needs permission to manage project organization policies and service-account API key bindings. Pulumi explicitly enforces Google's block on service-account-bound API keys while runtime credentials are disabled. When enabled, the constraint remains enforced and its `allowedServices` parameter permits only `aiplatform.googleapis.com`; it does not open authorization-key creation for other services and leaves the parent policy unchanged.

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

Identity Platform, IAM, optional organization policy, and budget configuration are protected from Pulumi deletion. The application projects remain outside Pulumi for their full lifecycle. Rotatable API keys deliberately are not protected. An intentional foundation teardown requires a separate reviewed change that removes both Pulumi `protect` and the GCP `PREVENT` deletion policies from Stack-owned resources.
