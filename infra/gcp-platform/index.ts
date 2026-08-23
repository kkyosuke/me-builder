import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import { authorizationKeyPolicyRule } from "../src/gcp-authorization-key-policy.ts";
import {
  verifyExistingGcpProject,
  verifyExistingGcpProjectBilling,
} from "../src/gcp-existing-project.ts";
import { pulumiGcsBackends, requirePulumiGcsBackend } from "../src/pulumi-backend.ts";

requirePulumiGcsBackend(process.env, pulumiGcsBackends.gcpPlatform);

const supportedEnvironments = ["development", "production"] as const;
type Environment = (typeof supportedEnvironments)[number];

const config = new pulumi.Config();
const environmentValue = config.require("environment");
if (!supportedEnvironments.includes(environmentValue as Environment)) {
  throw new Error(`Unsupported GCP platform environment: ${environmentValue}`);
}
const environment = environmentValue as Environment;
if (pulumi.getStack() !== environment) {
  throw new Error(`Stack ${pulumi.getStack()} must match environment ${environment}`);
}

const projectId = config.require("projectId");
const billingAccount = config.require("billingAccount");
const organizationId = config.get("organizationId");
const folderId = config.get("folderId");
if (organizationId && folderId) {
  throw new Error("Set only one of organizationId or folderId");
}

const budgetCurrencyCode = config.require("budgetCurrencyCode");
if (!/^[A-Z]{3}$/u.test(budgetCurrencyCode)) {
  throw new Error("budgetCurrencyCode must be a three-letter ISO 4217 code");
}
const monthlyBudgetAmount = config.requireNumber("monthlyBudgetAmount");
const vertexSpendCapAmount = config.requireNumber("vertexSpendCapAmount");
if (!Number.isInteger(monthlyBudgetAmount) || monthlyBudgetAmount <= 0) {
  throw new Error("monthlyBudgetAmount must be a positive whole-currency amount");
}
if (!Number.isInteger(vertexSpendCapAmount) || vertexSpendCapAmount <= 0) {
  throw new Error("vertexSpendCapAmount must be a positive whole-currency amount");
}
if (vertexSpendCapAmount > monthlyBudgetAmount) {
  throw new Error("vertexSpendCapAmount must not exceed the project monthlyBudgetAmount");
}

const credentialSlots = ["primary", "secondary"] as const;
type CredentialSlot = (typeof credentialSlots)[number];
const activeCredentialSlotValue = config.get("activeCredentialSlot") ?? "primary";
if (!credentialSlots.includes(activeCredentialSlotValue as CredentialSlot)) {
  throw new Error("activeCredentialSlot must be primary or secondary");
}
const activeCredentialSlot = activeCredentialSlotValue as CredentialSlot;
const credentialGenerations =
  config.requireObject<Partial<Record<CredentialSlot, string | null>>>("credentialGenerations");
for (const slot of credentialSlots) {
  const generation = credentialGenerations[slot];
  if (generation == null) continue;
  if (generation.length > 12 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(generation)) {
    throw new Error(
      `credentialGenerations.${slot} must be a lowercase key-name segment of at most 12 characters`,
    );
  }
}
if (credentialGenerations[activeCredentialSlot] == null) {
  throw new Error("The activeCredentialSlot must have a credential generation");
}

const vertexRuntimeCredentialsEnabled =
  config.getBoolean("vertexRuntimeCredentialsEnabled") ?? false;
const vertexSpendCapConfirmed = config.getBoolean("vertexSpendCapConfirmed") ?? false;
if (vertexRuntimeCredentialsEnabled && !vertexSpendCapConfirmed) {
  throw new Error("Confirm the Vertex AI service spend cap before enabling runtime credentials");
}
if (vertexRuntimeCredentialsEnabled && !organizationId && !folderId) {
  throw new Error("Vertex authorization keys require a project under an organization or folder");
}

const authorizedDomains = config.requireObject<string[]>("authorizedDomains");
const oauthRedirectUris = config.requireObject<string[]>("oauthRedirectUris");
const expectedAuthorizedDomains =
  environment === "development"
    ? ["localhost", "api.stg.kagami.kyosuke.dev"]
    : ["api.kagami.kyosuke.dev"];
if (
  authorizedDomains.length !== expectedAuthorizedDomains.length ||
  expectedAuthorizedDomains.some((domain) => !authorizedDomains.includes(domain))
) {
  throw new Error(`${environment} authorized domains must match the application callback hosts`);
}
const expectedRedirectUris =
  environment === "development"
    ? [
        "http://localhost:3000/api/auth/sso/callback",
        "https://api.stg.kagami.kyosuke.dev/api/auth/sso/callback",
      ]
    : ["https://api.kagami.kyosuke.dev/api/auth/sso/callback"];
if (
  oauthRedirectUris.length !== expectedRedirectUris.length ||
  expectedRedirectUris.some((uri) => !oauthRedirectUris.includes(uri))
) {
  throw new Error(`${environment} OAuth redirect URIs must match the application callback URLs`);
}
const googleOAuthClientId = config.require("googleOAuthClientId");
const googleOAuthClientSecret = config.requireSecret("googleOAuthClientSecret");
const protect = true;

const existingProject = gcp.organizations.getProjectOutput({ projectId });
const verifiedProject = pulumi
  .all({
    projectId: existingProject.projectId,
    number: existingProject.number,
    orgId: existingProject.orgId,
    folderId: existingProject.folderId,
  })
  .apply((actual) =>
    verifyExistingGcpProject(
      { projectId, organizationId, folderId },
      {
        projectId: actual.projectId,
        number: actual.number,
        orgId: actual.orgId,
        folderId: actual.folderId,
      },
    ),
  );

const cloudBillingApi = new gcp.projects.Service(
  "cloudbilling-googleapis-com",
  {
    project: verifiedProject.projectId,
    service: "cloudbilling.googleapis.com",
    disableDependentServices: false,
    disableOnDestroy: false,
  },
  { protect },
);

// The upstream project data source returns an empty billing account while the Cloud Billing API is
// disabled. Make the project ID depend on the service resource ID so a first preview leaves the
// read unknown and the update performs it only after enabling the API. This validates the existing
// association without managing it.
const billingReadableProjectId = cloudBillingApi.id.apply(() => projectId);
const existingProjectWithBilling = gcp.organizations.getProjectOutput(
  { projectId: billingReadableProjectId },
  { dependsOn: cloudBillingApi },
);
const verifiedProjectBilling = existingProjectWithBilling.billingAccount.apply(
  (actualBillingAccount) =>
    verifyExistingGcpProjectBilling(projectId, billingAccount, actualBillingAccount),
);

const enabledServices = [
  "aiplatform.googleapis.com",
  "apikeys.googleapis.com",
  "billingbudgets.googleapis.com",
  "identitytoolkit.googleapis.com",
  "iam.googleapis.com",
  "orgpolicy.googleapis.com",
  "serviceusage.googleapis.com",
] as const;
const services = [
  cloudBillingApi,
  ...enabledServices.map(
    (service) =>
      new gcp.projects.Service(
        service.replaceAll(".", "-"),
        {
          project: verifiedProject.projectId,
          service,
          disableDependentServices: false,
          disableOnDestroy: false,
        },
        { protect },
      ),
  ),
];

const identityPlatform = new gcp.identityplatform.Config(
  "identityPlatform",
  {
    project: verifiedProject.projectId,
    authorizedDomains,
    autodeleteAnonymousUsers: true,
    signIn: {
      allowDuplicateEmails: false,
      anonymous: { enabled: false },
      email: { enabled: false, passwordRequired: true },
    },
  },
  {
    dependsOn: services,
    protect,
  },
);

const googleProvider = new gcp.identityplatform.DefaultSupportedIdpConfig(
  "googleProvider",
  {
    project: verifiedProject.projectId,
    idpId: "google.com",
    enabled: true,
    clientId: googleOAuthClientId,
    clientSecret: googleOAuthClientSecret,
    deletionPolicy: "PREVENT",
  },
  {
    dependsOn: identityPlatform,
    protect,
    additionalSecretOutputs: ["clientSecret"],
  },
);

const projectBudget = new gcp.billing.Budget(
  "projectMonthlyBudget",
  {
    billingAccount: verifiedProjectBilling.billingAccount,
    displayName: `me-builder ${environment} monthly budget`,
    amount: {
      specifiedAmount: {
        currencyCode: budgetCurrencyCode,
        units: String(monthlyBudgetAmount),
      },
    },
    budgetFilter: {
      calendarPeriod: "MONTH",
      creditTypesTreatment: "EXCLUDE_ALL_CREDITS",
      projects: [pulumi.interpolate`projects/${verifiedProject.projectNumber}`],
    },
    thresholdRules: [0.5, 0.8, 1].map((thresholdPercent) => ({
      thresholdPercent,
      spendBasis: "CURRENT_SPEND",
    })),
    allUpdatesRule: {
      monitoringNotificationChannels: [],
      enableProjectLevelRecipients: true,
    },
    deletionPolicy: "PREVENT",
  },
  { dependsOn: services, protect },
);

const vertexServiceAccount = new gcp.serviceaccount.Account(
  "vertexRuntime",
  {
    project: verifiedProject.projectId,
    accountId: `me-builder-vertex-${environment}`,
    displayName: `me-builder Vertex AI ${environment}`,
  },
  { dependsOn: services, protect },
);

const vertexInferenceRole = new gcp.projects.IAMCustomRole(
  "vertexInferenceRole",
  {
    project: verifiedProject.projectId,
    roleId: "meBuilderVertexInference",
    title: "me-builder Vertex inference",
    description: "Invoke Gemini generation and embedding without Vertex resource administration",
    permissions: ["aiplatform.endpoints.predict"],
    deletionPolicy: "PREVENT",
  },
  { dependsOn: services, protect },
);

const vertexInferenceBinding = new gcp.projects.IAMMember(
  "vertex-inference-binding",
  {
    project: verifiedProject.projectId,
    role: vertexInferenceRole.name,
    member: pulumi.interpolate`serviceAccount:${vertexServiceAccount.email}`,
  },
  { dependsOn: [vertexServiceAccount, vertexInferenceRole], protect },
);

const vertexServiceUsageBinding = new gcp.projects.IAMMember(
  "vertex-service-usage-binding",
  {
    project: verifiedProject.projectId,
    role: "roles/serviceusage.serviceUsageConsumer",
    member: pulumi.interpolate`serviceAccount:${vertexServiceAccount.email}`,
  },
  { dependsOn: vertexServiceAccount, protect },
);

const authorizationKeyPolicy =
  organizationId || folderId
    ? new gcp.orgpolicy.Policy(
        "allowRestrictedServiceAccountApiKeys",
        {
          parent: pulumi.interpolate`projects/${verifiedProject.projectNumber}`,
          name: pulumi.interpolate`projects/${verifiedProject.projectNumber}/policies/iam.managed.disableServiceAccountApiKeyCreation`,
          spec: { rules: [authorizationKeyPolicyRule(vertexRuntimeCredentialsEnabled)] },
          deletionPolicy: "PREVENT",
        },
        { dependsOn: services, protect },
      )
    : undefined;

const identityPlatformApiKeys = Object.fromEntries(
  credentialSlots.flatMap((slot) => {
    const generation = credentialGenerations[slot];
    if (generation == null) return [];
    const key = new gcp.projects.ApiKey(
      `identityPlatformApiKey-${slot}`,
      {
        project: verifiedProject.projectId,
        name: `me-builder-identity-${environment}-${slot}-${generation}`,
        displayName: `me-builder Identity Platform ${environment} ${slot} ${generation}`,
        deletionPolicy: "DELETE",
        restrictions: {
          apiTargets: [
            {
              service: "identitytoolkit.googleapis.com",
              methods: ["google.cloud.identitytoolkit.v1.AuthenticationService.SignInWithIdp"],
            },
          ],
        },
      },
      { dependsOn: services },
    );
    return [[slot, key] as const];
  }),
) as Partial<Record<CredentialSlot, gcp.projects.ApiKey>>;

function createVertexAiApiKeys(authorizationKeyPolicy: gcp.orgpolicy.Policy) {
  return Object.fromEntries(
    credentialSlots.flatMap((slot) => {
      const generation = credentialGenerations[slot];
      if (generation == null) return [];
      const key = new gcp.projects.ApiKey(
        `vertexAiApiKey-${slot}`,
        {
          project: verifiedProject.projectId,
          name: `me-builder-vertex-${environment}-${slot}-${generation}`,
          displayName: `me-builder Vertex AI ${environment} ${slot} ${generation}`,
          deletionPolicy: "DELETE",
          serviceAccountEmail: vertexServiceAccount.email,
          restrictions: {
            apiTargets: [
              {
                service: "aiplatform.googleapis.com",
                methods: [
                  "google.cloud.aiplatform.v1.PredictionService.GenerateContent",
                  "google.cloud.aiplatform.v1.PredictionService.EmbedContent",
                ],
              },
            ],
          },
        },
        {
          dependsOn: [vertexInferenceBinding, vertexServiceUsageBinding, authorizationKeyPolicy],
        },
      );
      return [[slot, key] as const];
    }),
  ) as Partial<Record<CredentialSlot, gcp.projects.ApiKey>>;
}

const vertexAiApiKeys =
  vertexRuntimeCredentialsEnabled && authorizationKeyPolicy
    ? createVertexAiApiKeys(authorizationKeyPolicy)
    : undefined;

const activeIdentityPlatformApiKey = identityPlatformApiKeys[activeCredentialSlot];
if (!activeIdentityPlatformApiKey) throw new Error("Active Identity Platform API key is missing");
const activeVertexAiApiKey = vertexAiApiKeys?.[activeCredentialSlot];
if (vertexRuntimeCredentialsEnabled && !activeVertexAiApiKey) {
  throw new Error("Active Vertex AI API key is missing");
}

export const platform = {
  environment,
  projectId: verifiedProject.projectId,
  projectNumber: verifiedProject.projectNumber,
  billingAccount: verifiedProjectBilling.billingAccount,
  budgetCurrencyCode,
  monthlyBudgetAmount,
  vertexSpendCapAmount,
  vertexSpendCapConfirmed,
  vertexRuntimeCredentialsEnabled,
  activeCredentialSlot,
  identityProvider: googleProvider.idpId,
  googleOAuthClientId,
  oauthRedirectUris,
  identityPlatformApiKeys: pulumi.secret({
    ...(identityPlatformApiKeys.primary
      ? { primary: identityPlatformApiKeys.primary.keyString }
      : {}),
    ...(identityPlatformApiKeys.secondary
      ? { secondary: identityPlatformApiKeys.secondary.keyString }
      : {}),
  }),
  identityPlatformApiKey: pulumi.secret(activeIdentityPlatformApiKey.keyString),
  vertexAiServiceAccount: vertexServiceAccount.email,
  vertexAiApiKeys: vertexAiApiKeys
    ? pulumi.secret({
        ...(vertexAiApiKeys.primary ? { primary: vertexAiApiKeys.primary.keyString } : {}),
        ...(vertexAiApiKeys.secondary ? { secondary: vertexAiApiKeys.secondary.keyString } : {}),
      })
    : undefined,
  vertexAiApiKey: activeVertexAiApiKey ? pulumi.secret(activeVertexAiApiKey.keyString) : undefined,
  projectBudget: projectBudget.name,
};
