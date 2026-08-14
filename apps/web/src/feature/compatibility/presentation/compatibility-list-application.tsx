import { useCallback, useEffect, useState } from "react";
import {
  type RelationshipCategoryFilter,
  relationshipCategoryFilterFromSearch,
} from "../../diagnosis/model/relationship-category";
import { useLiffSession } from "../../liff";
import { shareCompatibilityInvitationToLine } from "../infrastructure/compatibility-invitation-sharing";
import type { CompatibilityRelationshipListItem } from "../model/compatibility-relationship";
import { CompatibilityListScreen } from "./compatibility-list-screen";
import { useCompatibilityRelationships } from "./hooks/use-compatibility-relationships";

export default function CompatibilityListApplication() {
  const { acquireIdToken, profile } = useLiffSession();
  const relationships = useCompatibilityRelationships({ acquireIdToken });
  const [sharingMessage, setSharingMessage] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<RelationshipCategoryFilter>(() =>
    relationshipCategoryFilterFromSearch(window.location.search),
  );

  useEffect(() => {
    const syncCategoryFilterWithHistory = () =>
      setCategoryFilter(relationshipCategoryFilterFromSearch(window.location.search));
    window.addEventListener("popstate", syncCategoryFilterWithHistory);
    return () => window.removeEventListener("popstate", syncCategoryFilterWithHistory);
  }, []);

  const changeCategoryFilter = useCallback((filter: RelationshipCategoryFilter) => {
    setCategoryFilter(filter);
    const url = new URL(window.location.href);
    if (filter === "all") {
      url.searchParams.delete("category");
    } else {
      url.searchParams.set("category", filter);
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  const resend = async (
    item: Extract<CompatibilityRelationshipListItem, { status: "pending" }>,
  ) => {
    try {
      const destination = await shareCompatibilityInvitationToLine(
        profile?.displayName ?? null,
        item.relationshipCategory,
        item.invitationUrl,
      );
      setSharingMessage(
        destination === "line"
          ? "LINEで招待を送信しました。"
          : destination === "system"
            ? "招待を共有しました。"
            : "送信をキャンセルしました。",
      );
    } catch (error) {
      setSharingMessage(error instanceof Error ? error.message : "LINEで送信できませんでした。");
    }
  };

  return (
    <CompatibilityListScreen
      categoryFilter={categoryFilter}
      state={relationships.state}
      operation={relationships.operation}
      cancellingRelationshipId={relationships.cancellingRelationshipId}
      sharingMessage={sharingMessage}
      onRetry={() => void relationships.reload()}
      onCancel={(relationshipId) => void relationships.cancel(relationshipId)}
      onCategoryFilterChange={changeCategoryFilter}
      onResend={(item) => void resend(item)}
    />
  );
}
