// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aoi, compatibilityListData, me } from "../infrastructure/compatibility-demo";
import type { CompatibilitySharePreview } from "../model/compatibility-share-preview";
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

  it("APIから取得した振る舞い・考え方をすべて表示し、詳細は共有しない", () => {
    const preview: CompatibilitySharePreview = {
      displayName: "うさぎ",
      previewToken: `csp2.${"a".repeat(64)}`,
      aboutMe: {
        profileSummaryVersionId: "summary-version-1",
        generatedAt: "2026-08-11T00:00:00.000Z",
        statements: [
          {
            key: "planning-style",
            label: "予定の立て方",
            statement: "私は、先の見通しを持って動けると安心しやすいです",
          },
        ],
      },
      themes: [
        {
          diagnosisId: "daily-life",
          title: "暮らし方",
          parameters: [
            {
              id: "planning",
              label: "予定の立て方",
              lowLabel: "その場で決めたい",
              highLabel: "早めに決めたい",
              position: 78,
              statement: "「早めに決めたい」傾向があります",
            },
            {
              id: "holiday",
              label: "休日の過ごし方",
              lowLabel: "ひとり時間を重視",
              highLabel: "一緒の時間を重視",
              position: 68,
              statement: "「一緒の時間を重視」傾向があります",
            },
          ],
        },
      ],
      canIssueInvitation: true,
      blockingReasons: [],
      nextAction: null,
    };
    render(
      <CompatibilityShareScreen state={{ status: "success", data: preview }} onRetry={vi.fn()} />,
    );

    expect(screen.getByText("うさぎさんから招待")).toBeTruthy();
    expect(screen.getByText("私は、先の見通しを持って動けると安心しやすいです")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "暮らし方" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "共有する振る舞い・考え方" })).toBeTruthy();
    expect(screen.getByText("2件すべて共有")).toBeTruthy();
    expect(screen.getByText("「早めに決めたい」傾向があります")).toBeTruthy();
    expect(screen.queryByText("「「早めに決めたい」傾向があります」")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/日記やLINEの会話本文/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "招待リンク発行は準備中" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("共有できる診断がなければ診断への導線を表示する", () => {
    render(
      <CompatibilityShareScreen
        state={{
          status: "success",
          data: {
            displayName: "うさぎ",
            previewToken: `csp2.${"b".repeat(64)}`,
            aboutMe: {
              profileSummaryVersionId: "summary-version-1",
              generatedAt: "2026-08-11T00:00:00.000Z",
              statements: [
                {
                  key: "planning-style",
                  label: "予定の立て方",
                  statement: "私は、先の見通しを持つことを大切にしています",
                },
              ],
            },
            themes: [],
            canIssueInvitation: false,
            blockingReasons: ["diagnosis_required"],
            nextAction: "diagnosis",
          },
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText(/共有できる診断結果がまだありません。/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "診断を始める" }).getAttribute("href")).toBe(
      "/diagnosis",
    );
    expect(
      screen.getByRole("button", { name: "招待リンクを発行できません" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("受信者が自分の共有内容と共有されない詳細を確認して承諾する", () => {
    render(<CompatibilityInvitationScreen inviter={aoi} recipient={me} />);

    expect(screen.getByText("あおいさんから招待が届いています")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "共有する振る舞い・考え方" })).toBeTruthy();
    expect(screen.getByText("3件すべて共有")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/日記やLINEの会話本文/)).toBeTruthy();
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
