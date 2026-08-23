const obsoleteResourceNames = new Set([
  "allowRestrictedServiceAccountApiKeys",
  "iam-googleapis-com",
  "orgpolicy-googleapis-com",
  "vertex-inference-binding",
  "vertex-service-usage-binding",
  "vertexInferenceRole",
  "vertexRuntime",
]);

/**
 * 旧Vertex credential実装がPulumi stateに残した削除保護対象だけを抽出する。
 */
export function obsoleteGcpPlatformResourceUrns(stackOutput: string): string[] {
  const urns = stackOutput.match(/urn:pulumi:[^\s]+/gu) ?? [];
  return [
    ...new Set(
      urns.filter((urn) => {
        const resourceName = urn.split("::").at(-1);
        return resourceName != null && obsoleteResourceNames.has(resourceName);
      }),
    ),
  ];
}
