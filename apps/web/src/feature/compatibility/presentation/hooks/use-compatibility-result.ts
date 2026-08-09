import { useCallback, useState } from "react";

type CompatibilityResultState = {
  section: "pair" | "people";
  sharing: "active" | "confirming-end" | "ended";
};

const initialState: CompatibilityResultState = {
  section: "people",
  sharing: "active",
};

export function useCompatibilityResult() {
  const [state, setState] = useState(initialState);

  const showSection = useCallback((section: CompatibilityResultState["section"]) => {
    setState((current) => ({ ...current, section }));
  }, []);
  const requestEnd = useCallback(() => {
    setState((current) => ({ ...current, sharing: "confirming-end" }));
  }, []);
  const cancelEnd = useCallback(() => {
    setState((current) => ({ ...current, sharing: "active" }));
  }, []);
  const confirmEnd = useCallback(() => {
    setState((current) => ({ ...current, sharing: "ended" }));
  }, []);

  return { state, showSection, requestEnd, cancelEnd, confirmEnd };
}
