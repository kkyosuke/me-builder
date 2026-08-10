import { deletePreviewDependents } from "../src/cloudflare";
import { requirePreviewConfirmation } from "../src/process";
import { destroyPreview } from "../src/pulumi";

requirePreviewConfirmation();
await deletePreviewDependents();
await destroyPreview();
