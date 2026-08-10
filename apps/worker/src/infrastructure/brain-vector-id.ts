const encoder = new TextEncoder();

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 同じSecretを使う2用途を入力prefixで分離する。 */
export function createBrainVectorId(
  secret: string,
  accountId: string,
  brainItemId: string,
): Promise<string> {
  return hmacHex(secret, `brain-vector-id\u0000${accountId}\u0000${brainItemId}`);
}

export function createBrainOwnerScope(secret: string, accountId: string): Promise<string> {
  return hmacHex(secret, `brain-owner-scope\u0000${accountId}`);
}
