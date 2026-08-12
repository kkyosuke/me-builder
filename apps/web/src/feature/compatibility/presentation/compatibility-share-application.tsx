import { useLiffSession } from "../../liff";
import { CompatibilityShareScreen } from "./compatibility-share-screen";
import { useCompatibilitySharePreview } from "./hooks/use-compatibility-share-preview";

export default function CompatibilityShareApplication() {
  const { acquireIdToken } = useLiffSession();
  const { state, reload } = useCompatibilitySharePreview({ acquireIdToken });

  return <CompatibilityShareScreen state={state} onRetry={() => void reload()} />;
}
