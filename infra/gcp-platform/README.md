# GCP platform infrastructure

This Pulumi project creates the Google Cloud foundation used by me-builder authentication and Vertex AI. It is intentionally separate from the Cloudflare Pulumi project so the `development` and `production` GCP projects have independent state and lifecycle.

## Managed resources

- environment-specific GCP project connected to the configured Cloud Billing account
- Service Usage, API Keys, IAM, Identity Toolkit, and Vertex AI APIs
- Identity Platform project configuration with anonymous, email/password, and phone sign-in disabled
- Google as the enabled Identity Platform provider
- an API key restricted to `identitytoolkit.googleapis.com`
- Vertex AI API
- a dedicated Vertex AI service account with only Vertex AI User and Service Usage Consumer roles
- a service-account-bound authorization key restricted to `aiplatform.googleapis.com`

Google Auth Platform owns the OAuth consent screen and Web OAuth client. Google requires the general-purpose user sign-in client and its consent configuration to be created manually in Cloud Console; the Pulumi GCP resources do not manage it. Create one client per Stack and pass its ID and secret to Pulumi. Do not substitute an IAP or workload OAuth client: those are different products, and the Pulumi IAP client resource is deprecated. When client credentials are not configured yet, Pulumi creates the project and Identity Platform foundation but intentionally leaves the Google provider absent.

The development client must contain both callback URIs listed in `Pulumi.development.yaml`. The production client must contain only the production callback in `Pulumi.production.yaml`.

## First deployment

Project IDs are globally unique. Use different values for the two Stacks and connect both to the same Billing Account used by Vertex AI.

```bash
cd infra/gcp-platform

pulumi stack init development
pulumi config set projectId <development-project-id> --stack development
pulumi config set projectName "me-builder platform development" --stack development
pulumi config set billingAccount <billing-account-id> --stack development
pulumi config set organizationId <organization-id> --stack development
pulumi up --stack development

pulumi stack init production
pulumi config set projectId <production-project-id> --stack production
pulumi config set projectName "me-builder platform production" --stack production
pulumi config set billingAccount <billing-account-id> --stack production
pulumi config set organizationId <organization-id> --stack production
pulumi up --stack production
```

After the first update, open Google Auth Platform in each newly created project, configure its consent screen, and create the environment's Web application client with the callback URIs in the Stack YAML. Then complete each Stack:

```bash
pulumi config set googleOAuthClientId <development-web-client-id> --stack development
pulumi config set --secret googleOAuthClientSecret <development-web-client-secret> --stack development
pulumi up --stack development

pulumi config set googleOAuthClientId <production-web-client-id> --stack production
pulumi config set --secret googleOAuthClientSecret <production-web-client-secret> --stack production
pulumi up --stack production
```

Use `folderId` instead of `organizationId` when the projects belong under a folder. Omit both only when the GCP account can create a project without an organization parent. Project creation requires project creator permission and Billing Account User permission on the selected Billing Account.

The `platform` Stack output contains both API keys as Pulumi secrets. Copy `identityPlatformApiKey` to `GOOGLE_IDENTITY_PLATFORM_API_KEY`, copy `vertexAiApiKey` to `GOOGLE_VERTEX_AI_API_KEY`, copy the client ID to `GOOGLE_OAUTH_CLIENT_ID`, and distribute the original client secret as `GOOGLE_OAUTH_CLIENT_SECRET` in the matching GitHub Environment. Never print secret outputs in CI logs.

The Vertex AI key is bound to the Stack's dedicated service account, not an unbound standard API key. The Worker continues to keep the value only in its server-side secret binding. API restriction limits the key to Vertex AI, while IAM limits the bound principal to model invocation and service consumption. Cloudflare Workers do not have stable outbound IP addresses, so this Stack intentionally does not add an IP restriction.

Before replacing an existing `GOOGLE_VERTEX_AI_API_KEY`, run the repository's Gemini connectivity check with the new Development key. Keep the old key active until Preview text generation and embedding both succeed; then replace the `dev` GitHub Environment secret. Production is migrated separately after the Development verification gate.

## Updates

From the repository root, use the scripts exposed by the parent infrastructure package:

```bash
bun --cwd infra gcp-platform:preview:development
bun --cwd infra gcp-platform:up:development
bun --cwd infra gcp-platform:preview:production
bun --cwd infra gcp-platform:up:production
```

Both projects and their Identity Platform and Vertex AI configuration are protected from Pulumi deletion. An intentional teardown requires a separate reviewed change that removes both Pulumi `protect` and the GCP `PREVENT` deletion policies.
