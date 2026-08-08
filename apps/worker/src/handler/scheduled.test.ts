import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeExpiredSessions: vi.fn(),
  processPendingDiagnosisBrainProjections: vi.fn(),
  db: {},
}));

vi.mock("@me-builder/lib", () => ({
  d1: {
    action: {
      conversation: { closeExpiredSessions: mocks.closeExpiredSessions },
      diagnosisBrainProjection: {
        processPendingDiagnosisBrainProjections: mocks.processPendingDiagnosisBrainProjections,
      },
    },
  },
}));
vi.mock("../config", () => ({
  getCloudflareBindings: () => ({ d1: mocks.db }),
}));

import { scheduledHandler } from "./scheduled";

describe("scheduledHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.closeExpiredSessions.mockResolvedValue(2);
    mocks.processPendingDiagnosisBrainProjections.mockResolvedValue({
      processed: 1,
      applied: 1,
      skippedIncomplete: 0,
      skippedInvalidConfig: 0,
      failed: 0,
    });
  });

  it("期限切れSessionと診断Brain projectionを並行して処理する", async () => {
    await scheduledHandler({} as ScheduledController, {} as never);

    expect(mocks.closeExpiredSessions).toHaveBeenCalledWith(mocks.db);
    expect(mocks.processPendingDiagnosisBrainProjections).toHaveBeenCalledWith(mocks.db);
  });
});
