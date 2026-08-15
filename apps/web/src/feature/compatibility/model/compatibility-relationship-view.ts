import type { CompatibilityPerson } from "./compatibility";
import type { CompatibilityRelationshipPerson } from "./compatibility-relationship";

export function toCompatibilityPerson(
  person: CompatibilityRelationshipPerson,
  color: CompatibilityPerson["color"],
): CompatibilityPerson {
  return {
    name: person.displayName,
    initial: person.displayName.slice(0, 1),
    color,
    profileGeneratedAt: person.aboutMe.generatedAt,
    statements: person.aboutMe.statements.map((statement) => statement.statement),
    themes: person.themes.flatMap((theme) =>
      theme.parameters.map((parameter) => ({
        id: `${theme.diagnosisId}:${parameter.id}`,
        title: parameter.label,
        axis: parameter.label,
        leftLabel: parameter.lowLabel,
        rightLabel: parameter.highLabel,
        position: parameter.position,
        statement: parameter.statement,
        request: "",
      })),
    ),
  };
}
