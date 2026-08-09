// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarSettingsScreen } from "./avatar-settings-screen";

describe("AvatarSettingsScreen", () => {
  afterEach(cleanup);

  it("人物を確認してからAI変換候補を設定できる", async () => {
    const onSave = vi.fn();
    render(<AvatarSettingsScreen currentAvatar={null} onBack={vi.fn()} onSave={onSave} />);

    expect(screen.queryByRole("button", { name: "朝焼けを選択" })).toBeNull();
    expect((screen.getByLabelText(/画像をアップロード/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /外部AIサービスへ送信/ }));
    fireEvent.change(screen.getByLabelText(/画像をアップロード/), {
      target: { files: [new File(["selfie"], "selfie.png", { type: "image/png" })] },
    });

    expect((await screen.findAllByText("selfie.png")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "ダミー変換を開始" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("人物が写っているか確認しています");
    expect(await screen.findByText("人物を確認できました")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ダミー変換を開始" }));
    fireEvent.click(screen.getByRole("button", { name: "若葉を選択" }));
    fireEvent.click(screen.getByRole("button", { name: "このアバターに設定" }));

    expect(onSave).toHaveBeenCalledWith({ kind: "preset", presetId: "leaf" });
  });

  it("人物を確認できなければ自分の画像の選び直しを案内する", async () => {
    render(<AvatarSettingsScreen currentAvatar={null} onBack={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /外部AIサービスへ送信/ }));
    fireEvent.change(screen.getByLabelText(/画像をアップロード/), {
      target: { files: [new File(["landscape"], "landscape.png", { type: "image/png" })] },
    });

    expect((await screen.findAllByText("landscape.png")).length).toBeGreaterThan(0);
    expect(await screen.findByText("人物を確認できました")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ダミー確認：人物なしの結果を試す" }));

    expect(screen.getByRole("alert").textContent).toContain("人物を確認できませんでした");
    expect(screen.getByText(/ご自身の顔や上半身が見やすい画像/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ダミー変換を開始" })).toBeNull();
    expect(screen.getByText("別の画像を選ぶ")).toBeTruthy();
  });

  it("現在のアバターとアップロード中の画像を区別して表示する", async () => {
    render(
      <AvatarSettingsScreen
        currentAvatar={{ kind: "preset", presetId: "water" }}
        onBack={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText("現在のアバター")).toBeTruthy();
    expect(screen.getByText("水面")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /外部AIサービスへ送信/ }));
    fireEvent.change(screen.getByLabelText(/画像をアップロード/), {
      target: { files: [new File(["selfie"], "new-selfie.png", { type: "image/png" })] },
    });

    expect((await screen.findAllByText("new-selfie.png")).length).toBeGreaterThan(0);
    expect(screen.getByText("現在のアバター")).toBeTruthy();
    expect(screen.getByText("水面")).toBeTruthy();
  });

  it("許可していない画像形式を拒否する", () => {
    render(<AvatarSettingsScreen currentAvatar={null} onBack={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /外部AIサービスへ送信/ }));
    fireEvent.change(screen.getByLabelText(/画像をアップロード/), {
      target: { files: [new File(["<svg />"], "avatar.svg", { type: "image/svg+xml" })] },
    });

    expect(screen.getByRole("alert").textContent).toContain("SVGは利用できません");
    expect(screen.queryByText("avatar.svg")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
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
