import { LIFF_ENDPOINT_PATHNAME } from "../../../model/liff-navigation";

const DEFAULT_ACCEPTANCE_DESTINATIONS = new Set(["/", LIFF_ENDPOINT_PATHNAME, "/terms"]);

/** 規約ゲートを開く前の機能導線を保ち、復帰先がない入口だけ「わたし」へ送る。 */
export function serviceTermsAcceptanceDestination(requestedLocation: string): string {
  const pathname = new URL(requestedLocation, "https://web.local").pathname;
  return DEFAULT_ACCEPTANCE_DESTINATIONS.has(pathname) ? "/me" : requestedLocation;
}
