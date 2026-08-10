// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarSettingsScreen } from "./avatar-settings-screen";

const mocks = vi.hoisted(() => ({
  normalizeAvatarImage: vi.fn(),
}));

vi.mock("../model/normalize-avatar-image", () => ({
  normalizeAvatarImage: mocks.normalizeAvatarImage,
}));

describe("AvatarSettingsScreen", () => {
  beforeEach(() => {
    mocks.normalizeAvatarImage.mockImplementation(async (file: File) => ({
      kind: "uploaded",
      dataUrl: `data:${file.type};base64,normalized`,
      fileName: file.name,
    }));
  });

  afterEach(cleanup);

  it("LINE画像を現在値として表示し、選んだ画像を明示操作で設定する", async () => {
    const onSave = vi.fn();
    render(
      <AvatarSettingsScreen
        currentAvatar={null}
        linePictureUrl="https://example.com/line-profile.jpg"
        onBack={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByText("LINEのプロフィール画像")).toBeTruthy();
    expect(screen.getByText("LINEのプロフィール画像を表示しています。")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "この画像を設定" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByText(/外部AIサービスへ送信/)).toBeNull();
    expect(screen.queryByText(/人物を確認/)).toBeNull();

    fireEvent.change(screen.getByLabelText("画像を選ぶ"), {
      target: { files: [new File(["avatar"], "new-avatar.png", { type: "image/png" })] },
    });

    expect(await screen.findByRole("heading", { name: "設定後のプレビュー" })).toBeTruthy();
    expect(screen.queryByText("new-avatar.png")).toBeNull();
    expect(mocks.normalizeAvatarImage).toHaveBeenCalledWith(
      expect.objectContaining({ name: "new-avatar.png" }),
    );
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "この画像を設定" }));
    expect(onSave).toHaveBeenCalledWith({
      kind: "uploaded",
      dataUrl: "data:image/png;base64,normalized",
      fileName: "new-avatar.png",
    });
  });

  it("許可していない画像形式を拒否して現在値を維持する", () => {
    const onSave = vi.fn();
    render(
      <AvatarSettingsScreen
        currentAvatar={null}
        linePictureUrl="https://example.com/line-profile.jpg"
        onBack={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("画像を選ぶ"), {
      target: { files: [new File(["<svg />"], "avatar.svg", { type: "image/svg+xml" })] },
    });

    expect(screen.getByRole("alert").textContent).toContain("SVGは利用できません");
    expect(screen.queryByText("avatar.svg")).toBeNull();
    expect(screen.getByText("LINEのプロフィール画像")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("閉じる操作では現在のアバターを変更しない", () => {
    const onBack = vi.fn();
    const onSave = vi.fn();
    render(
      <AvatarSettingsScreen
        currentAvatar={null}
        linePictureUrl="https://example.com/line-profile.jpg"
        onBack={onBack}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "アバター変更を閉じる" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("アプリで選んだ画像からLINE画像へ戻せる", () => {
    const onSave = vi.fn();
    render(
      <AvatarSettingsScreen
        currentAvatar={{
          kind: "uploaded",
          dataUrl: "data:image/png;base64,current",
          fileName: "current.png",
        }}
        linePictureUrl="https://example.com/line-profile.jpg"
        onBack={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByText("設定した画像")).toBeTruthy();
    expect(screen.queryByText("current.png")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "LINEの画像に戻す" }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("画像を処理できない場合は選び直しを案内する", async () => {
    mocks.normalizeAvatarImage.mockRejectedValueOnce(new Error("decode failed"));
    render(<AvatarSettingsScreen currentAvatar={null} onBack={vi.fn()} onSave={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("画像を選ぶ"), {
      target: { files: [new File(["broken"], "broken.png", { type: "image/png" })] },
    });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "画像を読み込めませんでした。別の画像を選んでください。",
    );
    expect(screen.queryByRole("heading", { name: "設定後のプレビュー" })).toBeNull();
  });

  it("LINE画像がない場合はアプリで選んだ画像を削除できる", () => {
    const onSave = vi.fn();
    render(
      <AvatarSettingsScreen
        currentAvatar={{
          kind: "uploaded",
          dataUrl: "data:image/png;base64,current",
          fileName: "current.png",
        }}
        onBack={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "現在の画像を削除" }));
    expect(onSave).toHaveBeenCalledWith(null);
  });
});
