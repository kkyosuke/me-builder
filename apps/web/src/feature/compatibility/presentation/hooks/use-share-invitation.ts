import { useCallback, useState } from "react";

type ShareState = "copy-failed" | "copied" | "editing" | "issued";

export function useShareInvitation({
  invitationUrl,
  copyInvitation,
}: {
  invitationUrl: string;
  copyInvitation: (url: string) => Promise<void>;
}) {
  const [state, setState] = useState<ShareState>("editing");

  const issue = useCallback(() => setState("issued"), []);
  const copy = useCallback(async () => {
    try {
      await copyInvitation(invitationUrl);
      setState("copied");
    } catch {
      setState("copy-failed");
    }
  }, [copyInvitation, invitationUrl]);

  return { state, issue, copy };
}
