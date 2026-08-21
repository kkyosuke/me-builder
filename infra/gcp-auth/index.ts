import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";

const supportedEnvironments = ["development", "production"] as const;
type Environment = (typeof supportedEnvironments)[number];

const config = new pulumi.Config();
const environmentValue = config.require("environment");
if (!supportedEnvironments.includes(environmentValue as Environment)) {
  throw new Error(`Unsupported GCP authentication environment: ${environmentValue}`);
}
const environment = environmentValue as Environment;
if (pulumi.getStack() !== environment) {
  throw new Error(`Stack ${pulumi.getStack()} must match environment ${environment}`);
}

const projectId = config.require("projectId");
const projectName = config.get("projectName") ?? `me-builder auth ${environment}`;
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
  "identityProject",
  {
    projectId,
    name: projectName,
    billingAccount,
    deletionPolicy: "PREVENT",
    autoCreateNetwork: false,
    labels: {
      application: "me-builder",
      environment,
      component: "authentication",
    },
    ...(organizationId ? { orgId: organizationId } : {}),
    ...(folderId ? { folderId } : {}),
  },
  { protect },
);

const enabledServices = [
  "apikeys.googleapis.com",
  "identitytoolkit.googleapis.com",
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

const apiKey = new gcp.projects.ApiKey(
  "identityPlatformApiKey",
  {
    project: project.projectId,
    name: `me-builder-identity-${environment}`,
    displayName: `me-builder Identity Platform ${environment}`,
    restrictions: {
      apiTargets: [{ service: "identitytoolkit.googleapis.com" }],
    },
  },
  { dependsOn: services, protect },
);

export const authentication = {
  environment,
  projectId: project.projectId,
  projectNumber: project.number,
  billingAccount,
  identityProvider: googleProvider?.idpId,
  googleOAuthClientId,
  oauthRedirectUris,
  identityPlatformApiKey: pulumi.secret(apiKey.keyString),
};
