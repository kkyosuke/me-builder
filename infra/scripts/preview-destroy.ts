import { deletePreviewDependents, deleteUnmanagedPreviewFoundation } from "../src/cloudflare";
import { requirePreviewConfirmation } from "../src/process";
import { destroyPreview } from "../src/pulumi";

requirePreviewConfirmation();
await deletePreviewDependents();
await destroyPreview();
// 通常CDが先に作った未adoptのbucketを含め、命名規則に属する残存基盤も片付ける。
await deleteUnmanagedPreviewFoundation();
