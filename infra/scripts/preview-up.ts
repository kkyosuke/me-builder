import { requireCloudflareEnvironment } from "../src/process";
import { updatePreview } from "../src/pulumi";

requireCloudflareEnvironment();
await updatePreview();
