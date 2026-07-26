import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { line } from "./index";

const CHANNEL_SECRET = "test-channel-secret";

/** LINE Platform と同じ手順 (HMAC-SHA256 → Base64) で署名を生成します。 */
function sign(body: string, channelSecret = CHANNEL_SECRET): string {
  return createHmac("SHA256", channelSecret).update(body).digest("base64");
}

describe("line.webhook.verifySignature", () => {
  const body = JSON.stringify({
    destination: "U0123456789abcdef",
    events: [{ type: "message", message: { type: "text", text: "hello" } }],
  });

  it("returns true for a signature generated with the same channel secret", () => {
    expect(
      line.webhook.verifySignature({
        body,
        channelSecret: CHANNEL_SECRET,
        signature: sign(body),
      }),
    ).toBe(true);
  });

  it("returns false when the signature was generated with a different channel secret", () => {
    expect(
      line.webhook.verifySignature({
        body,
        channelSecret: CHANNEL_SECRET,
        signature: sign(body, "another-channel-secret"),
      }),
    ).toBe(false);
  });

  it("returns false when the body was tampered with after signing", () => {
    const signature = sign(body);
    const tamperedBody = JSON.stringify({
      destination: "U0123456789abcdef",
      events: [{ type: "message", message: { type: "text", text: "tampered" } }],
    });

    expect(
      line.webhook.verifySignature({
        body: tamperedBody,
        channelSecret: CHANNEL_SECRET,
        signature,
      }),
    ).toBe(false);
  });

  it("returns false when the signature header is missing", () => {
    expect(
      line.webhook.verifySignature({ body, channelSecret: CHANNEL_SECRET, signature: undefined }),
    ).toBe(false);
    expect(
      line.webhook.verifySignature({ body, channelSecret: CHANNEL_SECRET, signature: null }),
    ).toBe(false);
    expect(
      line.webhook.verifySignature({ body, channelSecret: CHANNEL_SECRET, signature: "" }),
    ).toBe(false);
  });

  it("returns false for malformed (non-base64 / truncated) signature values", () => {
    expect(
      line.webhook.verifySignature({
        body,
        channelSecret: CHANNEL_SECRET,
        signature: "not-a-valid-signature",
      }),
    ).toBe(false);
    expect(
      line.webhook.verifySignature({
        body,
        channelSecret: CHANNEL_SECRET,
        signature: sign(body).slice(0, 10),
      }),
    ).toBe(false);
  });

  it("returns false when the channel secret is empty", () => {
    expect(line.webhook.verifySignature({ body, channelSecret: "", signature: sign(body) })).toBe(
      false,
    );
  });

  it("is sensitive to byte-level differences that JSON re-stringify would erase", () => {
    // LINE から届く生ボディ (整形済み JSON) の署名は、
    // JSON.parse → JSON.stringify した文字列では検証できないことを保証する。
    const rawBody = '{\n  "events": [],\n  "destination": "U0123456789abcdef"\n}';
    const signature = sign(rawBody);

    expect(
      line.webhook.verifySignature({ body: rawBody, channelSecret: CHANNEL_SECRET, signature }),
    ).toBe(true);
    expect(
      line.webhook.verifySignature({
        body: JSON.stringify(JSON.parse(rawBody)),
        channelSecret: CHANNEL_SECRET,
        signature,
      }),
    ).toBe(false);
  });
});
