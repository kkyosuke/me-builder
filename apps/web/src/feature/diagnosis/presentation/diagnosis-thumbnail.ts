const diagnosisThumbnails: Record<string, string> = {
  "relationship-priority": "/images/diagnoses/relationship-priority.jpg",
  "money-values": "/images/diagnoses/money-values.jpg",
  "leisure-style": "/images/diagnoses/leisure-style.jpg",
  "time-planning": "/images/diagnoses/time-planning.jpg",
  "conversation-emotion": "/images/diagnoses/conversation-emotion.jpg",
  "life-priorities": "/images/diagnoses/life-priorities.jpg",
  "work-values": "/images/diagnoses/work-values.jpg",
  "work-relationship-style": "/images/diagnoses/work-relationship-style.jpg",
  "family-support-style": "/images/diagnoses/family-support-style.jpg",
  "friendship-style": "/images/diagnoses/friendship-style.jpg",
  "decision-making-style": "/images/diagnoses/decision-making-style.jpg",
  "work-priority-style": "/images/diagnoses/work-priority-style.jpg",
};

export function getDiagnosisThumbnail(diagnosisId: string): string {
  return diagnosisThumbnails[diagnosisId] ?? "/images/diagnoses/default.jpg";
}
