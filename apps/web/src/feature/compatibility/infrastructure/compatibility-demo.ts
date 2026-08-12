import type { CompatibilityPerson } from "../model/compatibility";

export const me: CompatibilityPerson = {
  name: "わたし",
  initial: "わ",
  color: "sky",
  statements: [
    "私は、予定を早めに決めておけると安心します。",
    "私は、一緒に楽しむ時間を大切にしたいです。",
  ],
  themes: [
    {
      id: "planning",
      title: "予定の立て方",
      axis: "予定を決めるタイミング",
      leftLabel: "その場で決めたい",
      rightLabel: "早めに決めたい",
      position: 78,
      statement: "私は、予定を早めに決めておけると安心します。",
      request: "予定が変わるときは、早めに相談してもらえるとうれしいです。",
    },
    {
      id: "holiday",
      title: "休日の過ごし方",
      axis: "人と過ごす時間",
      leftLabel: "ひとり時間を重視",
      rightLabel: "一緒の時間を重視",
      position: 68,
      statement: "私は、一緒に楽しむ時間を大切にしたいです。",
      request: "したいことを一緒に相談できるとうれしいです。",
    },
    {
      id: "spending",
      title: "お金の使い方",
      axis: "体験への支出",
      leftLabel: "ものを重視",
      rightLabel: "体験を重視",
      position: 74,
      statement: "私は、思い出に残る体験へお金を使いたいです。",
      request: "大きな予定は、予算も一緒に話せるとうれしいです。",
    },
  ],
};

export const aoi: CompatibilityPerson = {
  name: "あおい",
  initial: "あ",
  color: "violet",
  statements: [
    "私は、見通しを持って動けると心地よく感じます。",
    "私は、自分で決められる余白を大切にしたいです。",
  ],
  themes: [
    {
      id: "planning",
      title: "予定の立て方",
      axis: "予定を決めるタイミング",
      leftLabel: "その場で決めたい",
      rightLabel: "早めに決めたい",
      position: 70,
      statement: "私は、見通しを持って動けると心地よく感じます。",
      request: "決まっていることを先に共有してもらえるとうれしいです。",
    },
    {
      id: "holiday",
      title: "休日の過ごし方",
      axis: "人と過ごす時間",
      leftLabel: "ひとり時間を重視",
      rightLabel: "一緒の時間を重視",
      position: 28,
      statement: "私は、自分で決められる余白を大切にしたいです。",
      request: "一人で考える時間も尊重してもらえるとうれしいです。",
    },
    {
      id: "spending",
      title: "お金の使い方",
      axis: "体験への支出",
      leftLabel: "ものを重視",
      rightLabel: "体験を重視",
      position: 81,
      statement: "私は、休日には新しい体験を楽しみたいです。",
      request: "気になる場所を気軽に提案し合えるとうれしいです。",
    },
  ],
};
