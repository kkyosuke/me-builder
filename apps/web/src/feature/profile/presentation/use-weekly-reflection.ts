import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../../../config";
import type { AsyncState } from "../../../model/async-state";
import {
  fetchWeeklyReflections,
  startWeeklyReflection,
} from "../infrastructure/weekly-reflection-api";
import type { WeeklyReflectionResult } from "../model/weekly-reflection";

export function useWeeklyReflection() {
  const [state, setState] = useState<AsyncState<WeeklyReflectionResult>>({ status: "loading" });
  const requestController = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      setState({
        status: "success",
        data: await fetchWeeklyReflections(config.apiUrl, controller.signal),
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "週次振り返りを取得できませんでした。",
      });
    }
  }, []);
  useEffect(() => {
    void load();
    return () => requestController.current?.abort();
  }, [load]);
  const generate = useCallback(async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      await startWeeklyReflection(config.apiUrl, controller.signal);
      for (let count = 0; count < 20; count += 1) {
        const result = await fetchWeeklyReflections(config.apiUrl, controller.signal);
        setState({ status: "success", data: result });
        if (result.generation.status === "completed" || result.generation.status === "failed")
          break;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "週次振り返りを生成できませんでした。",
      });
    }
  }, []);
  return { state, reload: load, generate };
}
