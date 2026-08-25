/** Brain Itemの生成方法とは独立して、命題に未明言の推定が含まれるかを判定する。 */
export function brainItemIsInference(
  attributes: unknown,
  derivation: "ai" | "deterministic",
): boolean {
  return attributes &&
    typeof attributes === "object" &&
    "isInference" in attributes &&
    typeof attributes.isInference === "boolean"
    ? attributes.isInference
    : derivation === "ai";
}
