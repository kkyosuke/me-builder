const diagnosisThumbnails: Record<string, string> = {
  "relationship-priority": "/images/diagnoses/relationship-priority.jpg",
  "money-values": "/images/diagnoses/money-values.jpg",
  "leisure-style": "/images/diagnoses/leisure-style.jpg",
  "time-planning": "/images/diagnoses/time-planning.jpg",
  "conversation-emotion": "/images/diagnoses/conversation-emotion.jpg",
  "life-priorities": "/images/diagnoses/life-priorities.jpg",
  "work-values": "/images/diagnoses/work-values.jpg",
  "work-relationship-style": "/images/diagnoses/work-relationship-style.jpg",
};

export function getDiagnosisThumbnail(diagnosisId: string): string {
  return diagnosisThumbnails[diagnosisId] ?? "/images/diagnoses/default.jpg";
}
