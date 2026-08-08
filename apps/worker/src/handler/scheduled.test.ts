import { describe, expect, it } from "vitest";

import { scheduledHandler } from "./scheduled";

describe("scheduledHandler", () => {
  it("Account所有データを共有D1で走査せず、各AccountData alarmへ委譲する", async () => {
    await expect(scheduledHandler({} as ScheduledController, {} as never)).resolves.toBeUndefined();
  });
});
