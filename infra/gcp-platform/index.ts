import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";

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
const projectName = config.get("projectName") ?? `me-builder platform ${environment}`;
const billingAccount = config.require("billingAccount");
const organizationId = config.get("organizationId");
const folderId = config.get("folderId");
if (organizationId && folderId) {
  throw new Error("Set only one of organizationId or folderId");
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
const googleOAuthClientId = config.get("googleOAuthClientId");
const googleOAuthClientSecret = config.getSecret("googleOAuthClientSecret");
if (
  (googleOAuthClientId && !googleOAuthClientSecret) ||
  (!googleOAuthClientId && googleOAuthClientSecret)
) {
  throw new Error("Set both googleOAuthClientId and googleOAuthClientSecret");
}
const protect = true;

const project = new gcp.organizations.Project(
  "platformProject",
  {
    projectId,
    name: projectName,
    billingAccount,
    deletionPolicy: "PREVENT",
    autoCreateNetwork: false,
    labels: {
      application: "me-builder",
      environment,
      component: "platform",
    },
    ...(organizationId ? { orgId: organizationId } : {}),
    ...(folderId ? { folderId } : {}),
  },
  { protect },
);

const enabledServices = [
  "aiplatform.googleapis.com",
  "apikeys.googleapis.com",
  "identitytoolkit.googleapis.com",
  "iam.googleapis.com",
  "serviceusage.googleapis.com",
] as const;
const services = enabledServices.map(
  (service) =>
    new gcp.projects.Service(
      service.replaceAll(".", "-"),
      {
        project: project.projectId,
        service,
        disableDependentServices: false,
        disableOnDestroy: false,
      },
      { dependsOn: project, protect },
    ),
);

const identityPlatform = new gcp.identityplatform.Config(
  "identityPlatform",
  {
    project: project.projectId,
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

const googleProvider =
  googleOAuthClientId && googleOAuthClientSecret
    ? new gcp.identityplatform.DefaultSupportedIdpConfig(
        "googleProvider",
        {
          project: project.projectId,
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
      )
    : undefined;

const vertexServiceAccount = new gcp.serviceaccount.Account(
  "vertexRuntime",
  {
    project: project.projectId,
    accountId: `me-builder-vertex-${environment}`,
    displayName: `me-builder Vertex AI ${environment}`,
  },
  { dependsOn: services, protect },
);

const vertexRoleBindings = ["roles/aiplatform.user", "roles/serviceusage.serviceUsageConsumer"].map(
  (role) =>
    new gcp.projects.IAMMember(
      `vertex-${role.replaceAll(/[./]/gu, "-")}`,
      {
        project: project.projectId,
        role,
        member: pulumi.interpolate`serviceAccount:${vertexServiceAccount.email}`,
      },
      { dependsOn: vertexServiceAccount, protect },
    ),
);

const apiKey = new gcp.projects.ApiKey(
  "identityPlatformApiKey",
  {
    project: project.projectId,
    name: `me-builder-identity-${environment}`,
    displayName: `me-builder Identity Platform ${environment}`,
    deletionPolicy: "PREVENT",
    restrictions: {
      apiTargets: [{ service: "identitytoolkit.googleapis.com" }],
    },
  },
  { dependsOn: services, protect },
);

const vertexApiKey = new gcp.projects.ApiKey(
  "vertexAiApiKey",
  {
    project: project.projectId,
    name: `me-builder-vertex-${environment}`,
    displayName: `me-builder Vertex AI ${environment}`,
    deletionPolicy: "PREVENT",
    serviceAccountEmail: vertexServiceAccount.email,
    restrictions: {
      apiTargets: [{ service: "aiplatform.googleapis.com" }],
    },
  },
  { dependsOn: [...services, ...vertexRoleBindings], protect },
);

export const platform = {
  environment,
  projectId: project.projectId,
  projectNumber: project.number,
  billingAccount,
  identityProvider: googleProvider?.idpId,
  googleOAuthClientId,
  oauthRedirectUris,
  identityPlatformApiKey: pulumi.secret(apiKey.keyString),
  vertexAiServiceAccount: vertexServiceAccount.email,
  vertexAiApiKey: pulumi.secret(vertexApiKey.keyString),
};
