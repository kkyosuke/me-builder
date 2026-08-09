// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aoi,
  compatibilityListData,
  demoInvitationUrl,
  me,
} from "../infrastructure/compatibility-demo";
import { CompatibilityInvitationScreen } from "./compatibility-invitation-screen";
import { CompatibilityListScreen } from "./compatibility-list-screen";
import { CompatibilityResultScreen } from "./compatibility-result-screen";
import { CompatibilityShareScreen } from "./compatibility-share-screen";

function firePointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  values: { button?: number; clientX: number; clientY: number; pointerId: number },
) {
  const event = new Event(type, { bubbles: true });
  for (const [key, value] of Object.entries({ isPrimary: true, ...values })) {
    Object.defineProperty(event, key, { value });
  }
  fireEvent(target, event);
}

describe("Compatibility flow", () => {
  afterEach(cleanup);

  it("一覧で結果あり・診断待ち・返事待ちを区別する", () => {
    render(<CompatibilityListScreen data={compatibilityListData} />);

    expect(screen.getByRole("heading", { name: "相性診断" })).toBeTruthy();
    expect(screen.getByText("結果あり")).toBeTruthy();
    expect(screen.getByText("診断待ち")).toBeTruthy();
    expect(screen.getByText("返事待ち")).toBeTruthy();
    expect(screen.getByRole("link", { name: "2人の相性シートを見る" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "相性" }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: "もう一度送る" }));
    expect(screen.getByText("LINEで送り直せる招待リンクを用意しました。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取り消す" }));
    expect(screen.getByText("招待を取り消しました。")).toBeTruthy();
    expect(screen.queryByText("返事待ち")).toBeNull();
  });

  it("振る舞い・考え方をすべて共有し、詳細は共有せずに招待リンクを発行する", async () => {
    const copyInvitation = vi.fn().mockResolvedValue(undefined);
    render(
      <CompatibilityShareScreen
        person={me}
        invitationUrl={demoInvitationUrl}
        lineShareUrl="https://line.me/R/msg/text/?demo"
        copyInvitation={copyInvitation}
      />,
    );

    expect(screen.getByRole("heading", { name: "共有する振る舞い・考え方" })).toBeTruthy();
    expect(screen.getByText("3件すべて共有")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/日記やLINEの会話から得た記憶/)).toBeTruthy();
    const issueButton = screen.getByRole("button", { name: "招待リンクを発行" });
    fireEvent.click(issueButton);

    expect(screen.getByText("招待リンクを発行しました")).toBeTruthy();
    expect(screen.getByRole("link", { name: "LINEで送る" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "リンクをコピー" }));
    expect(await screen.findByRole("button", { name: "コピーしました" })).toBeTruthy();
    expect(copyInvitation).toHaveBeenCalledWith(demoInvitationUrl);
  });

  it("受信者が自分の共有内容と共有されない詳細を確認して承諾する", () => {
    render(<CompatibilityInvitationScreen inviter={aoi} recipient={me} />);

    expect(screen.getByText("あおいさんから招待が届いています")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "共有する振る舞い・考え方" })).toBeTruthy();
    expect(screen.getByText("3件すべて共有")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/日記やLINEの会話から得た記憶/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "相性を見てみる" }));

    expect(
      screen.getByRole("heading", { name: "あおいさんとの相性シートを作りました" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "2人の相性シートを見る" })).toBeTruthy();
  });

  it("人物ごとの資料と2人の共通点・違いをタブとスワイプで切り替える", () => {
    render(<CompatibilityResultScreen me={me} partner={aoi} />);

    expect(screen.getByRole("heading", { name: "2人の相性シート" })).toBeTruthy();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(["あおいさんについて", "わたしについて"]);

    expect(screen.getByRole("tab", { name: "それぞれについて" })).toBeTruthy();
    const peoplePanel = screen.getByRole("tabpanel");
    firePointer(peoplePanel, "pointerdown", {
      button: 0,
      clientX: 180,
      clientY: 100,
      pointerId: 1,
    });
    firePointer(peoplePanel, "pointermove", {
      clientX: 130,
      clientY: 104,
      pointerId: 1,
    });
    expect(screen.getByTestId("compatibility-section-track").style.transform).toContain("-50px");
    firePointer(peoplePanel, "pointerup", {
      clientX: 100,
      clientY: 108,
      pointerId: 1,
    });
    expect(screen.getByRole("heading", { name: "一緒に大切にできそうなこと" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "話してみたい違い" })).toBeTruthy();
    expect(screen.getByTestId("compatibility-tab-indicator").style.transform).toBe(
      "translate3d(100%, 0, 0)",
    );

    const pairPanel = screen.getByRole("tabpanel");
    firePointer(pairPanel, "pointerdown", {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 2,
    });
    firePointer(pairPanel, "pointerup", {
      clientX: 180,
      clientY: 108,
      pointerId: 2,
    });
    expect(screen.getByRole("heading", { name: "あおいさんについて" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "2人について" }));

    fireEvent.click(screen.getByRole("button", { name: "共有を終了する" }));
    expect(
      screen.getByText("終了すると、2人ともこの相性シートを見られなくなります。"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "共有を終了" }));
    expect(screen.getByRole("heading", { name: "共有を終了しました" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "相性一覧へ戻る" })).toBeTruthy();
  });
});
