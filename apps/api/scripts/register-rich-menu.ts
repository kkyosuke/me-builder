import { line } from "@me-builder/lib";
import { logger } from "@me-builder/shared";
import { config } from "../src/config";

const targetEnv = process.argv[2];

if (targetEnv !== "preview" && targetEnv !== "production") {
  throw new Error("Usage: bun scripts/register-rich-menu.ts <preview|production>");
}

const imageFile = Bun.file(new URL("../assets/rich-menu-diagnosis.jpg", import.meta.url));
const imageBytes = await imageFile.arrayBuffer();
const liffIdBytes = new TextEncoder().encode(config.liffId ?? "");
const versionSource = new Uint8Array(imageBytes.byteLength + liffIdBytes.byteLength);
versionSource.set(new Uint8Array(imageBytes));
versionSource.set(liffIdBytes, imageBytes.byteLength);
const digest = await crypto.subtle.digest("SHA-256", versionSource);
const version = Array.from(new Uint8Array(digest).slice(0, 6), (byte) =>
  byte.toString(16).padStart(2, "0"),
).join("");

logger.info(`[Script] Executing LINE rich menu registration for ${targetEnv}...`);

const result = await line.richMenu.registerDefault({
  channelAccessToken: config.lineChannelAccessToken,
  liffId: config.liffId,
  namePrefix: `me-builder-diagnosis-${targetEnv}`,
  version,
  image: new Blob([imageBytes], { type: "image/jpeg" }),
});

if (!result.success) {
  throw new Error(`[Script] Rich menu registration failed: ${result.message}`);
}
