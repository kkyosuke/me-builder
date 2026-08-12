import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import type { AsyncState } from "../../../../model/async-state";
import { fetchCompatibilitySharePreview } from "../../infrastructure/compatibility-api";
import { fetchCompatibilityAvatarImage } from "../../infrastructure/compatibility-avatar-api";
import type { CompatibilitySharePreview } from "../../model/compatibility-share-preview";

export function useCompatibilitySharePreview({
  acquireIdToken,
}: {
  acquireIdToken: (signal: AbortSignal) => Promise<string | null>;
}) {
  const [state, setState] = useState<AsyncState<CompatibilitySharePreview>>({
    status: "loading",
  });
  const mounted = useRef(false);
  const loading = useRef(false);
  const request = useRef<AbortController | null>(null);
  const avatarObjectUrl = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (mounted.current) setState({ status: "loading" });
    try {
      const idToken = await acquireIdToken(controller.signal);
      if (controller.signal.aborted) return;
      if (!idToken) {
        throw new Error("LINEから相性共有画面を開いてください。");
      }
      const preview = await fetchCompatibilitySharePreview(
        config.apiUrl,
        idToken,
        controller.signal,
      );
      const avatarBlob = await fetchCompatibilityAvatarImage(
        config.apiUrl,
        idToken,
        preview.avatarUrl,
        controller.signal,
      );
      if (mounted.current && !controller.signal.aborted) {
        const nextAvatarObjectUrl = avatarBlob ? URL.createObjectURL(avatarBlob) : null;
        if (avatarObjectUrl.current) URL.revokeObjectURL(avatarObjectUrl.current);
        avatarObjectUrl.current = nextAvatarObjectUrl;
        setState({
          status: "success",
          data: { ...preview, avatarUrl: nextAvatarObjectUrl },
        });
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "共有する内容を読み込めませんでした。",
        });
      }
    } finally {
      if (request.current === controller) loading.current = false;
    }
  }, [acquireIdToken]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      mounted.current = false;
      request.current?.abort();
      if (avatarObjectUrl.current) URL.revokeObjectURL(avatarObjectUrl.current);
      avatarObjectUrl.current = null;
      loading.current = false;
    };
  }, [load]);

  return { state, reload: load };
}
