import { deletePreviewDependents, deleteUnmanagedPreviewFoundation } from "../src/cloudflare";
import { requirePreviewConfirmation } from "../src/process";

requirePreviewConfirmation();
await deletePreviewDependents();
await deleteUnmanagedPreviewFoundation();
