import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import { fetchAdminAccounts } from "../infrastructure/admin-api";
import type { AdminAccountFilters, AdminAccountPage } from "../model/account";

const initialFilters: AdminAccountFilters = {
  query: "",
  role: "all",
  status: "all",
  sort: "created",
};

export function useAdminAccounts() {
  const [state, setState] = useState<AsyncState<AdminAccountPage>>({ status: "loading" });
  const [filters, setFilters] = useState(initialFilters);
  const [appliedQuery, setAppliedQuery] = useState("");
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const activeController = useRef<AbortController | null>(null);
  const hasLoaded = useRef(false);
  const cursor = cursorStack[cursorStack.length - 1];

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setCursorStack([undefined]);
      setAppliedQuery(filters.query);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [filters.query]);

  const requestFilters = useMemo<AdminAccountFilters>(
    () => ({
      query: appliedQuery,
      role: filters.role,
      status: filters.status,
      sort: filters.sort,
    }),
    [appliedQuery, filters.role, filters.sort, filters.status],
  );
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (hasLoaded.current) setIsRefreshing(true);
      else setState({ status: "loading" });
      try {
        const page = await fetchAdminAccounts(config.apiUrl, requestFilters, cursor, signal);
        if (!signal.aborted) {
          hasLoaded.current = true;
          setState({ status: "success", data: page });
        }
      } catch (error) {
        if (!signal.aborted) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Account一覧を取得できませんでした。",
          });
        }
      } finally {
        if (!signal.aborted) setIsRefreshing(false);
      }
    },
    [cursor, requestFilters],
  );

  useEffect(() => {
    const controller = new AbortController();
    activeController.current?.abort();
    activeController.current = controller;
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const reload = useCallback(() => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    return load(controller.signal);
  }, [load]);

  const updateFilter = useCallback(
    <TKey extends keyof AdminAccountFilters>(key: TKey, value: AdminAccountFilters[TKey]) => {
      if (key !== "query") setCursorStack([undefined]);
      setFilters((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const nextPage = useCallback(() => {
    if (state.status !== "success" || !state.data.nextCursor) return;
    setCursorStack((current) => [...current, state.data.nextCursor ?? undefined]);
  }, [state]);
  const previousPage = useCallback(() => {
    setCursorStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  return {
    state,
    filters,
    isRefreshing,
    pageNumber: cursorStack.length,
    canGoBack: cursorStack.length > 1,
    updateFilter,
    nextPage,
    previousPage,
    reload,
  };
}
