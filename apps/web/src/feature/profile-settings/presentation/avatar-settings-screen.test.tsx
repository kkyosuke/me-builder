// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarSettingsScreen } from "./avatar-settings-screen";

describe("AvatarSettingsScreen", () => {
  afterEach(cleanup);

  it("ダミー候補を表示し、選択した候補を設定できる", () => {
    const onSave = vi.fn();
    render(<AvatarSettingsScreen currentAvatar={null} onBack={vi.fn()} onSave={onSave} />);

    expect(screen.queryByRole("button", { name: "朝焼けを選択" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ダミー候補を表示" }));
    fireEvent.click(screen.getByRole("button", { name: "若葉を選択" }));
    fireEvent.click(screen.getByRole("button", { name: "このアバターに設定" }));

    expect(onSave).toHaveBeenCalledWith({ kind: "preset", presetId: "leaf" });
  });

  it("現在のアバターを削除できる", () => {
    const onSave = vi.fn();
    render(
      <AvatarSettingsScreen
        currentAvatar={{ kind: "preset", presetId: "water" }}
        onBack={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "現在のアバターを削除" }));
    expect(onSave).toHaveBeenCalledWith(null);
  });
});
