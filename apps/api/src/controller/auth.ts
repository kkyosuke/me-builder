export function bearerToken(authorization: string | undefined): string | undefined {
  return authorization?.trim().match(/^Bearer\s+([^\s]+)$/i)?.[1];
}
