import { useCallback, useEffect, useState } from "react";
import { applyFontSize, readFontSize, saveFontSize } from "../../infrastructure/font-size-storage";
import type { FontSize } from "../../model/font-size";

export function useFontSize(): {
  fontSize: FontSize;
  setFontSize: (fontSize: FontSize) => void;
} {
  const [fontSize, setFontSize] = useState(readFontSize);

  useEffect(() => {
    applyFontSize(fontSize);
  }, [fontSize]);

  const selectFontSize = useCallback((next: FontSize) => {
    saveFontSize(next);
    setFontSize(next);
  }, []);

  return { fontSize, setFontSize: selectFontSize };
}
