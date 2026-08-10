// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarSettingsScreen } from "./avatar-settings-screen";
import type { AvatarSettingsController } from "./use-avatar-settings";

const timestamp = "2026-08-10T00:00:00.000Z";

function controller(overrides: Partial<AvatarSettingsController> = {}): AvatarSettingsController {
  return {
    currentAvatar: null,
    job: null,
    loadStatus: "ready",
    errorMessage: null,
    busy: false,
    refresh: vi.fn().mockResolvedValue(true),
    upload: vi.fn().mockResolvedValue(true),
    choose: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function job(
  status: NonNullable<AvatarSettingsController["job"]>["status"],
): NonNullable<AvatarSettingsController["job"]> {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    status,
    errorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: timestamp,
    candidates: [],
  };
}

describe("AvatarSettingsScreen", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn().mockReturnValue("blob:upload"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(cleanup);

  it("画像をプレビューしてから送信し、受付後にモーダルを閉じる", async () => {
    const state = controller();
    const onSaved = vi.fn();
    render(<AvatarSettingsScreen controller={state} onBack={vi.fn()} onSaved={onSaved} />);

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/画像を使う権利と、写っている人の同意/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "この画像で候補を作る" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const input = screen.getByLabelText("アバター用の画像ファイルを選ぶ") as HTMLInputElement;
    expect(input.disabled).toBe(false);
    const file = new File(["selfie"], "selfie.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(state.upload).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "送信する画像のプレビュー" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "この画像で候補を作る" }));

    await waitFor(() => expect(state.upload).toHaveBeenCalledWith(file));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it("人物を確認できなければ自分の画像の選び直しを案内する", () => {
    render(
      <AvatarSettingsScreen
        controller={controller({ job: job("not_person") })}
        onBack={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("人物を確認できませんでした");
    expect(screen.getByRole("alert").textContent).toContain("ご自身の顔や上半身が見やすい画像");
    expect(screen.queryByRole("button", { name: "アバター生成を開始" })).toBeNull();
  });

  it("生成候補を選択して設定できる", async () => {
    const readyJob = job("ready");
    readyJob.candidates = [
      {
        id: "00000000-0000-4000-8000-000000000002",
        src: "blob:candidate",
        expiresAt: timestamp,
      },
    ];
    const state = controller({ job: readyJob });
    const onSaved = vi.fn();
    render(<AvatarSettingsScreen controller={state} onBack={vi.fn()} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: "候補1を選択" }));
    fireEvent.click(screen.getByRole("button", { name: "このアバターに設定" }));

    expect(state.choose).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002");
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it("初期取得後にreadyになった場合は候補選択へ切り替える", () => {
    const initial = controller({ loadStatus: "loading" });
    const { rerender } = render(
      <AvatarSettingsScreen controller={initial} onBack={vi.fn()} onSaved={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "アバター画像を選ぶ" })).toBeTruthy();

    const readyJob = job("ready");
    readyJob.candidates = [
      {
        id: "00000000-0000-4000-8000-000000000004",
        src: "blob:late-candidate",
        expiresAt: timestamp,
      },
    ];
    rerender(
      <AvatarSettingsScreen
        controller={controller({ job: readyJob })}
        onBack={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "候補から選ぶ" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "候補1を選択" })).toBeTruthy();
  });

  it("許可していない画像形式を拒否する", () => {
    const state = controller();
    render(<AvatarSettingsScreen controller={state} onBack={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("アバター用の画像ファイルを選ぶ"), {
      target: { files: [new File(["<svg />"], "avatar.svg", { type: "image/svg+xml" })] },
    });

    expect(screen.getByRole("alert").textContent).toContain("SVGは利用できません");
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("現在のアバターを削除できる", () => {
    const state = controller({
      currentAvatar: { id: "00000000-0000-4000-8000-000000000003", src: "blob:avatar" },
    });
    render(<AvatarSettingsScreen controller={state} onBack={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "現在のアバターを削除" }));
    expect(state.remove).toHaveBeenCalledOnce();
  });
});
