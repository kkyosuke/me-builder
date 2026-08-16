import type { billing } from "@me-builder/lib";
import type { SafetyRoute } from "./diary-chat";

const SELF_CARE_INTENT =
  /(しんど|つら|辛い|疲れ|ストレス|休み方|休みたい|落ち着|セルフケア|気分転換|対処|どうしたら|何をすれば)/u;

export function shouldLoadSelfCareContext(
  input: Readonly<{
    mode: billing.EntitlementPolicy["selfCareContext"];
    safetyRoute: SafetyRoute;
    currentText: string;
  }>,
): boolean {
  return (
    input.safetyRoute === "normal" &&
    input.mode !== "general" &&
    SELF_CARE_INTENT.test(input.currentText)
  );
}
