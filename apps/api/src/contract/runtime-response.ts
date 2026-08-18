const pathParameterPattern = /:([^/]+)/g;

type OpenApiResponse = { content?: Record<string, unknown> };
type OpenApiOperation = { responses?: Record<string, OpenApiResponse> };
export type RuntimeContractDocument = {
  paths: Record<string, Record<string, OpenApiOperation | undefined>>;
};

function normalizeContentType(value: string | undefined): string | undefined {
  return value?.split(";", 1)[0]?.trim().toLowerCase();
}

export function assertRuntimeResponseContract(
  document: RuntimeContractDocument,
  method: string,
  routePath: string,
  response: Response,
): void {
  const openApiPath = routePath.replace(pathParameterPattern, "{$1}");
  const route = `${method.toUpperCase()} ${routePath}`;
  const operation = document.paths[openApiPath]?.[method.toLowerCase()];
  if (!operation) throw new Error(`${route} is not registered in the OpenAPI document`);

  const documentedResponse =
    operation.responses?.[String(response.status)] ?? operation.responses?.default;
  if (!documentedResponse) {
    throw new Error(`${route} returned undocumented status ${response.status}`);
  }

  const documentedContentTypes = Object.keys(documentedResponse.content ?? {}).map((contentType) =>
    contentType.toLowerCase(),
  );
  const actualContentType = normalizeContentType(response.headers.get("content-type") ?? undefined);
  if (documentedContentTypes.length === 0) {
    if (actualContentType) {
      throw new Error(
        `${route} returned ${actualContentType} for bodyless status ${response.status}`,
      );
    }
    return;
  }
  if (!actualContentType || !documentedContentTypes.includes(actualContentType)) {
    throw new Error(
      `${route} returned undocumented content type ${actualContentType ?? "<none>"} for status ${response.status}`,
    );
  }
}
