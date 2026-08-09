// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { aoi, me } from "../infrastructure/compatibility-demo";
import { CompatibilityInvitationScreen } from "./compatibility-invitation-screen";
import { CompatibilityListScreen } from "./compatibility-list-screen";
import { CompatibilityResultScreen } from "./compatibility-result-screen";
import { CompatibilityShareScreen } from "./compatibility-share-screen";

describe("Compatibility flow", () => {
  afterEach(cleanup);

  it("一覧で結果あり・診断待ち・返事待ちを区別する", () => {
    render(<CompatibilityListScreen />);

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

  it("共有テーマを確認してから招待リンクを発行する", async () => {
    render(<CompatibilityShareScreen person={me} />);

    expect(screen.getByRole("heading", { name: "私について" })).toBeTruthy();
    const issueButton = screen.getByRole("button", { name: "招待リンクを発行" });
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    expect((issueButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("共有するテーマを1つ以上選んでください。")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /予定の立て方/ }));
    expect((issueButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(issueButton);

    expect(screen.getByText("招待リンクを発行しました")).toBeTruthy();
    expect(screen.getByRole("link", { name: "LINEで送る" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "リンクをコピー" }));
    expect(await screen.findByRole("button", { name: "コピーしました" })).toBeTruthy();
  });

  it("受信者が自分の共有内容を選んで明示的に承諾する", () => {
    render(<CompatibilityInvitationScreen inviter={aoi} recipient={me} />);

    expect(screen.getByText("あおいさんから招待が届いています")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "私について" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "相性を見てみる" }));

    expect(
      screen.getByRole("heading", { name: "あおいさんとの相性シートを作りました" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "2人の相性シートを見る" })).toBeTruthy();
  });

  it("人物ごとの資料と2人の共通点・違いを切り替える", () => {
    render(<CompatibilityResultScreen me={me} partner={aoi} />);

    expect(screen.getByRole("heading", { name: "2人の相性シート" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "わたしについて" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "あおいさんについて" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "2人について" }));
    expect(screen.getByRole("heading", { name: "一緒に大切にできそうなこと" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "話してみたい違い" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "共有を終了する" }));
    expect(
      screen.getByText("終了すると、2人ともこの相性シートを見られなくなります。"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "共有を終了" }));
    expect(screen.getByRole("heading", { name: "共有を終了しました" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "相性一覧へ戻る" })).toBeTruthy();
  });
});
