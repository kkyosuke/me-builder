export const VERTEX_AUTHORIZATION_KEY_SERVICE = "aiplatform.googleapis.com";

/** authorization keyを全面許可せず、Vertex AIへのbindingだけを許可する。 */
export function authorizationKeyPolicyRule(enabled: boolean): {
  enforce: "TRUE";
  parameters?: string;
} {
  return enabled
    ? {
        enforce: "TRUE",
        parameters: JSON.stringify({ allowedServices: [VERTEX_AUTHORIZATION_KEY_SERVICE] }),
      }
    : { enforce: "TRUE" };
}
