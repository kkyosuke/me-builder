import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../../config";
import type { AsyncState } from "../../../../model/async-state";
import { fetchCompatibilityInvitation } from "../../infrastructure/compatibility-api";
import { fetchCompatibilityAvatarImage } from "../../infrastructure/compatibility-avatar-api";
import type { CompatibilityInvitationPreview } from "../../model/compatibility-invitation-preview";

export function useCompatibilityInvitationPreview({
  relationshipId,
}: {
  relationshipId: string | null;
}) {
  const [state, setState] = useState<AsyncState<CompatibilityInvitationPreview>>({
    status: "loading",
  });
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const avatarObjectUrls = useRef<string[]>([]);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (mounted.current) setState({ status: "loading" });
    try {
      if (!relationshipId) throw new Error("この招待リンクは利用できません。");
      const invitation = await fetchCompatibilityInvitation(
        config.apiUrl,
        relationshipId,
        controller.signal,
      );
      const [inviterAvatarBlob, recipientAvatarBlob] = await Promise.all([
        fetchCompatibilityAvatarImage(
          config.apiUrl,
          invitation.inviter.avatarUrl,
          controller.signal,
        ),
        fetchCompatibilityAvatarImage(
          config.apiUrl,
          invitation.recipient.avatarUrl,
          controller.signal,
        ),
      ]);
      if (mounted.current && !controller.signal.aborted) {
        const nextAvatarObjectUrls = [inviterAvatarBlob, recipientAvatarBlob].map((blob) =>
          blob ? URL.createObjectURL(blob) : null,
        );
        for (const url of avatarObjectUrls.current) URL.revokeObjectURL(url);
        avatarObjectUrls.current = nextAvatarObjectUrls.filter((url): url is string =>
          Boolean(url),
        );
        setState({
          status: "success",
          data: {
            ...invitation,
            inviter: { ...invitation.inviter, avatarUrl: nextAvatarObjectUrls[0] ?? null },
            recipient: { ...invitation.recipient, avatarUrl: nextAvatarObjectUrls[1] ?? null },
          },
        });
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "招待内容を読み込めませんでした。",
        });
      }
    }
  }, [relationshipId]);

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
      for (const url of avatarObjectUrls.current) URL.revokeObjectURL(url);
      avatarObjectUrls.current = [];
    };
  }, [load]);

  return { state, reload: load };
}
