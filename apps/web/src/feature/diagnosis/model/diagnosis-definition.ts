import type { DiagnosisQuestion } from "./types";

/** 画面へ渡す診断定義。取得元に依存しないfeature内のモデルとして扱う。 */
export interface DiagnosisDefinition {
  id: string;
  title: string;
  description: string;
  questions: DiagnosisQuestion[];
}
