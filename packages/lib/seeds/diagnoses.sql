-- Phase 1 diagnosis catalog seed.
--
-- Apply the schema migrations before executing this file. This seed is intentionally
-- separate from Drizzle migrations because diagnosis content has its own
-- publication lifecycle. Existing published content is not rewritten. The UPSERT below
-- only fills migration-added fields while they are empty or NULL.
-- Revise published content by adding a new Question Version and a new Diagnosis instead.
--
-- Timestamps: 2026-08-04T00:00:00.000Z for the initial diagnoses and
-- 2026-08-06T00:00:00.000Z for leisure-style and time-planning, and
-- 2026-08-09T00:00:00.000Z for conversation-emotion
-- (Unix seconds, Drizzle timestamp mode).

INSERT OR IGNORE INTO questions (id, created_at, updated_at, is_deleted) VALUES
  ('q-relationship-priority-01', 1785801600, 1785801600, 0),
  ('q-relationship-priority-02', 1785801600, 1785801600, 0),
  ('q-relationship-priority-03', 1785801600, 1785801600, 0),
  ('q-relationship-priority-04', 1785801600, 1785801600, 0),
  ('q-relationship-priority-05', 1785801600, 1785801600, 0),
  ('q-relationship-priority-06', 1785801600, 1785801600, 0),
  ('q-relationship-priority-07', 1785801600, 1785801600, 0),
  ('q-relationship-priority-08', 1785801600, 1785801600, 0),
  ('q-relationship-priority-09', 1785801600, 1785801600, 0),
  ('q-relationship-priority-10', 1785801600, 1785801600, 0),
  ('q-money-01', 1785801600, 1785801600, 0),
  ('q-money-02', 1785801600, 1785801600, 0),
  ('q-money-03', 1785801600, 1785801600, 0),
  ('q-money-04', 1785801600, 1785801600, 0),
  ('q-money-05', 1785801600, 1785801600, 0),
  ('q-money-06', 1785801600, 1785801600, 0),
  ('q-money-07', 1785801600, 1785801600, 0),
  ('q-money-08', 1785801600, 1785801600, 0),
  ('q-money-09', 1785801600, 1785801600, 0),
  ('q-money-10', 1785801600, 1785801600, 0),
  ('q-leisure-style-01', 1785974400, 1785974400, 0),
  ('q-leisure-style-02', 1785974400, 1785974400, 0),
  ('q-leisure-style-03', 1785974400, 1785974400, 0),
  ('q-leisure-style-04', 1785974400, 1785974400, 0),
  ('q-leisure-style-05', 1785974400, 1785974400, 0),
  ('q-leisure-style-06', 1785974400, 1785974400, 0),
  ('q-leisure-style-07', 1785974400, 1785974400, 0),
  ('q-leisure-style-08', 1785974400, 1785974400, 0),
  ('q-leisure-style-09', 1785974400, 1785974400, 0),
  ('q-leisure-style-10', 1785974400, 1785974400, 0),
  ('q-time-planning-01', 1785974400, 1785974400, 0),
  ('q-time-planning-02', 1785974400, 1785974400, 0),
  ('q-time-planning-03', 1785974400, 1785974400, 0),
  ('q-time-planning-04', 1785974400, 1785974400, 0),
  ('q-time-planning-05', 1785974400, 1785974400, 0),
  ('q-time-planning-06', 1785974400, 1785974400, 0),
  ('q-time-planning-07', 1785974400, 1785974400, 0),
  ('q-time-planning-08', 1785974400, 1785974400, 0),
  ('q-time-planning-09', 1785974400, 1785974400, 0),
  ('q-time-planning-10', 1785974400, 1785974400, 0),
  ('q-conversation-emotion-01', 1786233600, 1786233600, 0),
  ('q-conversation-emotion-02', 1786233600, 1786233600, 0),
  ('q-conversation-emotion-03', 1786233600, 1786233600, 0),
  ('q-conversation-emotion-04', 1786233600, 1786233600, 0),
  ('q-conversation-emotion-05', 1786233600, 1786233600, 0),
  ('q-conversation-emotion-06', 1786233600, 1786233600, 0),
  ('q-conversation-emotion-07', 1786233600, 1786233600, 0),
  ('q-conversation-emotion-08', 1786233600, 1786233600, 0),
  ('q-conversation-emotion-09', 1786233600, 1786233600, 0),
  ('q-conversation-emotion-10', 1786233600, 1786233600, 0);
--> statement-breakpoint

INSERT OR IGNORE INTO question_versions (
  created_at,
  updated_at,
  is_deleted,
  question_id,
  version,
  state,
  text,
  format,
  approved_at
) VALUES
  (1785801600, 1785801600, 0, 'q-relationship-priority-01', 1, 'approved', '相手から頼まれても、自分に余裕がなければ断りたい。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-relationship-priority-02', 1, 'approved', '自分の予定より、相手が困っていることを優先したい。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-relationship-priority-03', 1, 'approved', '相手に合わせるために、自分の希望を変えることが多い。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-relationship-priority-04', 1, 'approved', '断るときは、詳しい理由を説明するべきだと思う。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-relationship-priority-05', 1, 'approved', '相手が一人で決めたことでも、本人の選択として尊重できる。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-relationship-priority-06', 1, 'approved', '大切な決断は、自分に関することでも相手へ相談したい。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-relationship-priority-07', 1, 'approved', '自分が我慢すれば済むことは、相手に言わずに我慢しやすい。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-relationship-priority-08', 1, 'approved', '相手の機嫌が悪くても、自分の責任だとは限らないと思える。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-relationship-priority-09', 1, 'approved', '相手を支えるためなら、一時的に自分の予定を減らしてもよい。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-relationship-priority-10', 1, 'approved', '相手の期待に応えられないときでも、自分を優先してよいと思う。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-money-01', 1, 'approved', '収入は、今の楽しみより将来のために多く残したい。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-money-02', 1, 'approved', '欲しいもののためなら、貯金の予定を少し崩してもよい。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-money-03', 1, 'approved', '自分のお金で高額な買い物をするときも、相手へ事前に相談したい。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-money-04', 1, 'approved', '生活費は、収入に関係なく同じ金額を負担するのが公平だと思う。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-money-05', 1, 'approved', '値段が高くても、長く使えるものを選びたい。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-money-06', 1, 'approved', '記念日の贈り物には、ある程度お金をかけたい。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-money-07', 1, 'approved', '借金やローンの状況は、交際の早い段階で共有してほしい。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-money-08', 1, 'approved', '投資には、元本割れの可能性があっても挑戦したい。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-money-09', 1, 'approved', '家事や時間の負担が多い人は、生活費の負担が少なくてもよいと思う。', 'single_choice', 1785801600),
  (1785801600, 1785801600, 0, 'q-money-10', 1, 'approved', '家計を一緒にする場合でも、自由に使える個人のお金を残したい。', 'single_choice', 1785801600),
  (1785974400, 1785974400, 0, 'q-leisure-style-01', 1, 'approved', '予定のない休日は、家で過ごすより外へ出たい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-leisure-style-02', 1, 'approved', '休日は、休息より新しい体験を優先したい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-leisure-style-03', 1, 'approved', '趣味は、パートナーと一緒に楽しみたい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-leisure-style-04', 1, 'approved', '相手が興味を持つ趣味なら、自分も一度は試したい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-leisure-style-05', 1, 'approved', '旅行は、観光地を多く回りたい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-leisure-style-06', 1, 'approved', '長期休暇には、家で休むより旅行へ行きたい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-leisure-style-07', 1, 'approved', '運動やスポーツを、休日の予定に入れたい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-leisure-style-08', 1, 'approved', '外出にお金を使うより、家で楽しむためにお金を使いたい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-leisure-style-09', 1, 'approved', '休日を別々に過ごしても平気だ。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-leisure-style-10', 1, 'approved', '混雑していても、人気のイベントへ出かけたい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-time-planning-01', 1, 'approved', '休日の予定は、前日までに決めておきたい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-time-planning-02', 1, 'approved', '急な誘いでも、予定が空いていれば参加したい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-time-planning-03', 1, 'approved', '待ち合わせに10分遅れる場合は、必ず連絡してほしい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-time-planning-04', 1, 'approved', '一緒に過ごす予定は、一人の予定より優先したい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-time-planning-05', 1, 'approved', '予定の変更が続くと、相手への信頼が下がる。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-time-planning-06', 1, 'approved', '旅行では、行程を事前に細かく決めたい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-time-planning-07', 1, 'approved', '予定どおりに進まなくても、その場で楽しめる。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-time-planning-08', 1, 'approved', '約束の時間より早く着くように行動したい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-time-planning-09', 1, 'approved', '忙しい時期でも、定期的に会う日を決めておきたい。', 'single_choice', 1785974400),
  (1785974400, 1785974400, 0, 'q-time-planning-10', 1, 'approved', '何もしない時間も、一緒に過ごす大切な予定だと思う。', 'single_choice', 1785974400),
  (1786233600, 1786233600, 0, 'q-conversation-emotion-01', 1, 'approved', '悩みを話したときは、解決策より先に共感してほしい。', 'single_choice', 1786233600),
  (1786233600, 1786233600, 0, 'q-conversation-emotion-02', 1, 'approved', '好意や感謝は、行動だけでなく言葉でも伝えてほしい。', 'single_choice', 1786233600),
  (1786233600, 1786233600, 0, 'q-conversation-emotion-03', 1, 'approved', '不満は、気づいた時点ですぐ伝えたい。', 'single_choice', 1786233600),
  (1786233600, 1786233600, 0, 'q-conversation-emotion-04', 1, 'approved', '落ち込んでいるときは、そっとしておくより声をかけてほしい。', 'single_choice', 1786233600),
  (1786233600, 1786233600, 0, 'q-conversation-emotion-05', 1, 'approved', '落ち込んでいるときは、声をかけてもらうより、一人で過ごして気持ちを整理したい。', 'single_choice', 1786233600),
  (1786233600, 1786233600, 0, 'q-conversation-emotion-06', 1, 'approved', '自分の弱さや不安を、パートナーへ見せられる。', 'single_choice', 1786233600),
  (1786233600, 1786233600, 0, 'q-conversation-emotion-07', 1, 'approved', '弱さや不安は、相手に話す前に、まず自分の中で整理したい。', 'single_choice', 1786233600),
  (1786233600, 1786233600, 0, 'q-conversation-emotion-08', 1, 'approved', '希望はすぐ言葉にせず、相手の様子やタイミングを見て伝えたい。', 'single_choice', 1786233600),
  (1786233600, 1786233600, 0, 'q-conversation-emotion-09', 1, 'approved', '悩みを話したときは、気持ちへの共感より具体的な解決策を一緒に考えてほしい。', 'single_choice', 1786233600),
  (1786233600, 1786233600, 0, 'q-conversation-emotion-10', 1, 'approved', '愛情は言葉で確かめなくても、行動や態度から感じ取れれば十分だ。', 'single_choice', 1786233600);
--> statement-breakpoint

INSERT OR IGNORE INTO question_choices (
  created_at,
  updated_at,
  is_deleted,
  question_id,
  question_version,
  choice_id,
  label,
  position
)
SELECT
  CASE WHEN id LIKE 'q-conversation-emotion-%' THEN 1786233600 WHEN id LIKE 'q-leisure-style-%' OR id LIKE 'q-time-planning-%' THEN 1785974400 ELSE 1785801600 END,
  CASE WHEN id LIKE 'q-conversation-emotion-%' THEN 1786233600 WHEN id LIKE 'q-leisure-style-%' OR id LIKE 'q-time-planning-%' THEN 1785974400 ELSE 1785801600 END,
  0,
  id,
  1,
  'no',
  'いいえ',
  0
FROM questions
WHERE id IN (
  'q-relationship-priority-01', 'q-relationship-priority-02',
  'q-relationship-priority-03', 'q-relationship-priority-04',
  'q-relationship-priority-05', 'q-relationship-priority-06',
  'q-relationship-priority-07', 'q-relationship-priority-08',
  'q-relationship-priority-09', 'q-relationship-priority-10',
  'q-money-01', 'q-money-02', 'q-money-03', 'q-money-04', 'q-money-05',
  'q-money-06', 'q-money-07', 'q-money-08', 'q-money-09', 'q-money-10',
  'q-leisure-style-01', 'q-leisure-style-02', 'q-leisure-style-03',
  'q-leisure-style-04', 'q-leisure-style-05', 'q-leisure-style-06',
  'q-leisure-style-07', 'q-leisure-style-08', 'q-leisure-style-09',
  'q-leisure-style-10',
  'q-time-planning-01', 'q-time-planning-02',
  'q-time-planning-03', 'q-time-planning-04',
  'q-time-planning-05', 'q-time-planning-06',
  'q-time-planning-07', 'q-time-planning-08',
  'q-time-planning-09', 'q-time-planning-10',
  'q-conversation-emotion-01', 'q-conversation-emotion-02',
  'q-conversation-emotion-03', 'q-conversation-emotion-04',
  'q-conversation-emotion-05', 'q-conversation-emotion-06',
  'q-conversation-emotion-07', 'q-conversation-emotion-08',
  'q-conversation-emotion-09', 'q-conversation-emotion-10'
);
--> statement-breakpoint

INSERT OR IGNORE INTO question_choices (
  created_at,
  updated_at,
  is_deleted,
  question_id,
  question_version,
  choice_id,
  label,
  position
)
SELECT
  CASE WHEN id LIKE 'q-conversation-emotion-%' THEN 1786233600 WHEN id LIKE 'q-leisure-style-%' OR id LIKE 'q-time-planning-%' THEN 1785974400 ELSE 1785801600 END,
  CASE WHEN id LIKE 'q-conversation-emotion-%' THEN 1786233600 WHEN id LIKE 'q-leisure-style-%' OR id LIKE 'q-time-planning-%' THEN 1785974400 ELSE 1785801600 END,
  0,
  id,
  1,
  'yes',
  'はい',
  1
FROM questions
WHERE id IN (
  'q-relationship-priority-01', 'q-relationship-priority-02',
  'q-relationship-priority-03', 'q-relationship-priority-04',
  'q-relationship-priority-05', 'q-relationship-priority-06',
  'q-relationship-priority-07', 'q-relationship-priority-08',
  'q-relationship-priority-09', 'q-relationship-priority-10',
  'q-money-01', 'q-money-02', 'q-money-03', 'q-money-04', 'q-money-05',
  'q-money-06', 'q-money-07', 'q-money-08', 'q-money-09', 'q-money-10',
  'q-leisure-style-01', 'q-leisure-style-02', 'q-leisure-style-03',
  'q-leisure-style-04', 'q-leisure-style-05', 'q-leisure-style-06',
  'q-leisure-style-07', 'q-leisure-style-08', 'q-leisure-style-09',
  'q-leisure-style-10',
  'q-time-planning-01', 'q-time-planning-02',
  'q-time-planning-03', 'q-time-planning-04',
  'q-time-planning-05', 'q-time-planning-06',
  'q-time-planning-07', 'q-time-planning-08',
  'q-time-planning-09', 'q-time-planning-10',
  'q-conversation-emotion-01', 'q-conversation-emotion-02',
  'q-conversation-emotion-03', 'q-conversation-emotion-04',
  'q-conversation-emotion-05', 'q-conversation-emotion-06',
  'q-conversation-emotion-07', 'q-conversation-emotion-08',
  'q-conversation-emotion-09', 'q-conversation-emotion-10'
);
--> statement-breakpoint

INSERT OR IGNORE INTO diagnosis_scoring_configs (
  id,
  created_at,
  updated_at,
  is_deleted,
  version,
  definition
) VALUES
  (
    'relationship-priority-v1',
    1785801600,
    1785801600,
    0,
    1,
    '{
      "parameters": [
        {"id":"priority-balance","label":"自分／相手の優先","lowLabel":"相手を優先しやすい","highLabel":"自分の余裕を優先しやすい"},
        {"id":"autonomy","label":"自律／相談","lowLabel":"相談・共有を重視","highLabel":"個人の判断を尊重"},
        {"id":"boundary-expression","label":"境界の表明","lowLabel":"内側で調整しやすい","highLabel":"境界を伝えやすい"},
        {"id":"support-flexibility","label":"支援の柔軟性","lowLabel":"自分の予定を守りやすい","highLabel":"相手のために調整しやすい"}
      ],
      "choiceScores": {"yes":1,"no":-1},
      "questions": {
        "q-relationship-priority-01":{"questionVersion":1,"weights":{"priority-balance":1,"boundary-expression":1}},
        "q-relationship-priority-02":{"questionVersion":1,"weights":{"priority-balance":-1,"support-flexibility":1}},
        "q-relationship-priority-03":{"questionVersion":1,"weights":{"priority-balance":-1,"boundary-expression":-1}},
        "q-relationship-priority-04":{"questionVersion":1,"weights":{"autonomy":-1}},
        "q-relationship-priority-05":{"questionVersion":1,"weights":{"autonomy":1}},
        "q-relationship-priority-06":{"questionVersion":1,"weights":{"autonomy":-1}},
        "q-relationship-priority-07":{"questionVersion":1,"weights":{"priority-balance":-1,"boundary-expression":-1}},
        "q-relationship-priority-08":{"questionVersion":1,"weights":{"autonomy":1,"boundary-expression":1}},
        "q-relationship-priority-09":{"questionVersion":1,"weights":{"priority-balance":-1,"support-flexibility":1}},
        "q-relationship-priority-10":{"questionVersion":1,"weights":{"priority-balance":1,"autonomy":0.5,"boundary-expression":1,"support-flexibility":-1}}
      },
      "minimumCoverage":0.6,
      "lowMaximum":35,
      "highMinimum":65,
      "balancedLabel":"状況に応じて調整"
    }'
  ),
  (
    'money-values-v1',
    1785801600,
    1785801600,
    0,
    1,
    '{
      "parameters": [
        {"id":"future-preparation","label":"将来への備え","lowLabel":"今の楽しみに使いやすい","highLabel":"将来への備えを重視"},
        {"id":"financial-sharing","label":"お金の共有","lowLabel":"個人の裁量を重視","highLabel":"相談・情報共有を重視"},
        {"id":"fairness-flexibility","label":"負担の公平性","lowLabel":"同額負担を公平と感じやすい","highLabel":"状況に応じた負担を重視"},
        {"id":"durable-value","label":"支出の価値","lowLabel":"体験・気持ちへの支出を重視","highLabel":"長く使える価値を重視"},
        {"id":"risk-tolerance","label":"リスク許容","lowLabel":"損失回避を重視","highLabel":"リスクを取れる"}
      ],
      "choiceScores": {"yes":1,"no":-1},
      "questions": {
        "q-money-01":{"questionVersion":1,"weights":{"future-preparation":1,"risk-tolerance":-0.5}},
        "q-money-02":{"questionVersion":1,"weights":{"future-preparation":-1,"durable-value":-0.5,"risk-tolerance":0.5}},
        "q-money-03":{"questionVersion":1,"weights":{"financial-sharing":1}},
        "q-money-04":{"questionVersion":1,"weights":{"fairness-flexibility":-1}},
        "q-money-05":{"questionVersion":1,"weights":{"future-preparation":0.5,"durable-value":1}},
        "q-money-06":{"questionVersion":1,"weights":{"future-preparation":-0.5,"durable-value":-1}},
        "q-money-07":{"questionVersion":1,"weights":{"financial-sharing":1}},
        "q-money-08":{"questionVersion":1,"weights":{"risk-tolerance":1}},
        "q-money-09":{"questionVersion":1,"weights":{"fairness-flexibility":1}},
        "q-money-10":{"questionVersion":1,"weights":{"financial-sharing":-1}}
      },
      "minimumCoverage":0.6,
      "lowMaximum":35,
      "highMinimum":65,
      "balancedLabel":"状況に応じて調整"
    }'
  ),
  (
    'leisure-style-v1',
    1785974400,
    1785974400,
    0,
    1,
    '{
      "parameters": [
        {"id":"outdoor-preference","label":"外出志向","lowLabel":"家で過ごすことを好む","highLabel":"外へ出ることを好む"},
        {"id":"experience-openness","label":"体験への開放性","lowLabel":"慣れた過ごし方を好む","highLabel":"新しい体験を好む"},
        {"id":"shared-leisure","label":"余暇の共有","lowLabel":"それぞれの時間を重視","highLabel":"一緒に楽しむことを重視"},
        {"id":"activity-level","label":"活動量","lowLabel":"ゆったり過ごす","highLabel":"活動的に過ごす"}
      ],
      "choiceScores": {"yes":1,"no":-1},
      "questions": {
        "q-leisure-style-01":{"questionVersion":1,"weights":{"outdoor-preference":1}},
        "q-leisure-style-02":{"questionVersion":1,"weights":{"experience-openness":1,"activity-level":0.5}},
        "q-leisure-style-03":{"questionVersion":1,"weights":{"shared-leisure":1}},
        "q-leisure-style-04":{"questionVersion":1,"weights":{"experience-openness":0.5,"shared-leisure":0.5}},
        "q-leisure-style-05":{"questionVersion":1,"weights":{"experience-openness":0.5,"activity-level":1}},
        "q-leisure-style-06":{"questionVersion":1,"weights":{"outdoor-preference":1,"activity-level":0.5}},
        "q-leisure-style-07":{"questionVersion":1,"weights":{"activity-level":1}},
        "q-leisure-style-08":{"questionVersion":1,"weights":{"outdoor-preference":-1}},
        "q-leisure-style-09":{"questionVersion":1,"weights":{"shared-leisure":-1}},
        "q-leisure-style-10":{"questionVersion":1,"weights":{"experience-openness":0.5,"activity-level":0.5}}
      },
      "minimumCoverage":0.6,
      "lowMaximum":35,
      "highMinimum":65,
      "balancedLabel":"状況に応じて楽しむ"
    }'
  ),
  (
    'time-planning-v1',
    1785974400,
    1785974400,
    0,
    1,
    '{
      "parameters": [
        {"id":"advance-planning","label":"事前計画","lowLabel":"直前やその場で決めたい","highLabel":"前もって決めたい"},
        {"id":"spontaneous-flexibility","label":"予定変更への柔軟性","lowLabel":"決めた予定を保ちたい","highLabel":"その場の変化を楽しめる"},
        {"id":"time-reliability","label":"時間と約束","lowLabel":"時間の幅を広く捉える","highLabel":"時間と連絡を明確にしたい"},
        {"id":"shared-time-priority","label":"一緒の時間","lowLabel":"個人の予定を優先しやすい","highLabel":"一緒に過ごす時間を確保したい"}
      ],
      "choiceScores": {"yes":1,"no":-1},
      "questions": {
        "q-time-planning-01":{"questionVersion":1,"weights":{"advance-planning":1}},
        "q-time-planning-02":{"questionVersion":1,"weights":{"spontaneous-flexibility":1}},
        "q-time-planning-03":{"questionVersion":1,"weights":{"time-reliability":1}},
        "q-time-planning-04":{"questionVersion":1,"weights":{"shared-time-priority":1}},
        "q-time-planning-05":{"questionVersion":1,"weights":{"time-reliability":0.5,"spontaneous-flexibility":-0.5}},
        "q-time-planning-06":{"questionVersion":1,"weights":{"advance-planning":1}},
        "q-time-planning-07":{"questionVersion":1,"weights":{"spontaneous-flexibility":1}},
        "q-time-planning-08":{"questionVersion":1,"weights":{"time-reliability":1}},
        "q-time-planning-09":{"questionVersion":1,"weights":{"advance-planning":0.5,"shared-time-priority":1}},
        "q-time-planning-10":{"questionVersion":1,"weights":{"shared-time-priority":1}}
      },
      "minimumCoverage":0.6,
      "lowMaximum":35,
      "highMinimum":65,
      "balancedLabel":"状況に応じて予定を決める"
    }'
  ),
  (
    'conversation-emotion-v1',
    1786233600,
    1786233600,
    0,
    1,
    '{
      "parameters": [
        {"id":"empathetic-reception","label":"共感的な受け止め","lowLabel":"事実や解決を整理しやすい","highLabel":"気持ちから受け止めやすい"},
        {"id":"verbal-affection","label":"言葉での愛情表現","lowLabel":"行動や態度から感じ取りやすい","highLabel":"言葉で確かめたい"},
        {"id":"direct-communication","label":"希望の伝え方","lowLabel":"様子やタイミングを見やすい","highLabel":"言葉で明確に伝えたい"},
        {"id":"active-support","label":"落ち込んだときの支援","lowLabel":"そっと見守ることを重視","highLabel":"声をかけることを重視"},
        {"id":"emotional-openness","label":"感情の共有","lowLabel":"自分の中で整理しやすい","highLabel":"相手と共有しやすい"}
      ],
      "choiceScores": {"yes":1,"no":0},
      "questions": {
        "q-conversation-emotion-01":{"questionVersion":1,"weights":{"empathetic-reception":1}},
        "q-conversation-emotion-02":{"questionVersion":1,"weights":{"verbal-affection":1}},
        "q-conversation-emotion-03":{"questionVersion":1,"weights":{"direct-communication":1}},
        "q-conversation-emotion-04":{"questionVersion":1,"weights":{"active-support":1}},
        "q-conversation-emotion-05":{"questionVersion":1,"weights":{"active-support":-1}},
        "q-conversation-emotion-06":{"questionVersion":1,"weights":{"emotional-openness":1}},
        "q-conversation-emotion-07":{"questionVersion":1,"weights":{"emotional-openness":-1}},
        "q-conversation-emotion-08":{"questionVersion":1,"weights":{"direct-communication":-1}},
        "q-conversation-emotion-09":{"questionVersion":1,"weights":{"empathetic-reception":-1}},
        "q-conversation-emotion-10":{"questionVersion":1,"weights":{"verbal-affection":-1}}
      },
      "minimumCoverage":0.6,
      "lowMaximum":35,
      "highMinimum":65,
      "balancedLabel":"状況に応じて伝え方を選ぶ"
    }'
  );
--> statement-breakpoint

INSERT INTO diagnoses (
  id,
  created_at,
  updated_at,
  is_deleted,
  title,
  description,
  relationship_category,
  scoring_config_id,
  display_order,
  opens_at,
  state,
  published_at
) VALUES
  ('relationship-priority', 1785801600, 1785801600, 0, '自分と相手の優先・境界線', '頼まれごとや意思決定で、自分と相手をどう尊重するかを見ます。', 'general', 'relationship-priority-v1', 10, 1785801600, 'published', 1785801600),
  ('money-values', 1785801600, 1785801600, 0, 'お金と消費', '貯蓄、支出、共有、公平性、リスクに関する傾向を見ます。', 'general', 'money-values-v1', 20, 1785801600, 'published', 1785801600),
  ('leisure-style', 1785974400, 1785974400, 0, 'インドア・アウトドアと余暇', '休日の過ごし方、体験、趣味の共有、活動量に関する傾向を見ます。', 'general', 'leisure-style-v1', 30, 1785801600, 'published', 1785974400),
  ('time-planning', 1785974400, 1785974400, 0, '時間と予定', '予定の立て方、変更への柔軟性、時間の約束、一緒の時間に関する傾向を見ます。', 'general', 'time-planning-v1', 40, 1785801600, 'published', 1785974400),
  ('conversation-emotion', 1786233600, 1786233600, 0, '会話と感情表現', '共感、愛情表現、希望の伝え方、支え方、感情の共有に関する傾向を見ます。', 'general', 'conversation-emotion-v1', 50, 1785801600, 'published', 1786233600)
ON CONFLICT(id) DO UPDATE SET
  description = CASE
    WHEN diagnoses.description = '' THEN excluded.description
    ELSE diagnoses.description
  END,
  scoring_config_id = COALESCE(diagnoses.scoring_config_id, excluded.scoring_config_id),
  display_order = excluded.display_order
WHERE diagnoses.description = ''
  OR diagnoses.scoring_config_id IS NULL
  OR diagnoses.display_order <> excluded.display_order;
--> statement-breakpoint

INSERT OR IGNORE INTO diagnosis_questions (
  id,
  created_at,
  updated_at,
  is_deleted,
  diagnosis_id,
  question_id,
  question_version,
  position
) VALUES
  ('dq-relationship-priority-01', 1785801600, 1785801600, 0, 'relationship-priority', 'q-relationship-priority-01', 1, 0),
  ('dq-relationship-priority-02', 1785801600, 1785801600, 0, 'relationship-priority', 'q-relationship-priority-02', 1, 1),
  ('dq-relationship-priority-03', 1785801600, 1785801600, 0, 'relationship-priority', 'q-relationship-priority-03', 1, 2),
  ('dq-relationship-priority-04', 1785801600, 1785801600, 0, 'relationship-priority', 'q-relationship-priority-04', 1, 3),
  ('dq-relationship-priority-05', 1785801600, 1785801600, 0, 'relationship-priority', 'q-relationship-priority-05', 1, 4),
  ('dq-relationship-priority-06', 1785801600, 1785801600, 0, 'relationship-priority', 'q-relationship-priority-06', 1, 5),
  ('dq-relationship-priority-07', 1785801600, 1785801600, 0, 'relationship-priority', 'q-relationship-priority-07', 1, 6),
  ('dq-relationship-priority-08', 1785801600, 1785801600, 0, 'relationship-priority', 'q-relationship-priority-08', 1, 7),
  ('dq-relationship-priority-09', 1785801600, 1785801600, 0, 'relationship-priority', 'q-relationship-priority-09', 1, 8),
  ('dq-relationship-priority-10', 1785801600, 1785801600, 0, 'relationship-priority', 'q-relationship-priority-10', 1, 9),
  ('dq-money-01', 1785801600, 1785801600, 0, 'money-values', 'q-money-01', 1, 0),
  ('dq-money-02', 1785801600, 1785801600, 0, 'money-values', 'q-money-02', 1, 1),
  ('dq-money-03', 1785801600, 1785801600, 0, 'money-values', 'q-money-03', 1, 2),
  ('dq-money-04', 1785801600, 1785801600, 0, 'money-values', 'q-money-04', 1, 3),
  ('dq-money-05', 1785801600, 1785801600, 0, 'money-values', 'q-money-05', 1, 4),
  ('dq-money-06', 1785801600, 1785801600, 0, 'money-values', 'q-money-06', 1, 5),
  ('dq-money-07', 1785801600, 1785801600, 0, 'money-values', 'q-money-07', 1, 6),
  ('dq-money-08', 1785801600, 1785801600, 0, 'money-values', 'q-money-08', 1, 7),
  ('dq-money-09', 1785801600, 1785801600, 0, 'money-values', 'q-money-09', 1, 8),
  ('dq-money-10', 1785801600, 1785801600, 0, 'money-values', 'q-money-10', 1, 9),
  ('dq-leisure-style-01', 1785974400, 1785974400, 0, 'leisure-style', 'q-leisure-style-01', 1, 0),
  ('dq-leisure-style-02', 1785974400, 1785974400, 0, 'leisure-style', 'q-leisure-style-02', 1, 1),
  ('dq-leisure-style-03', 1785974400, 1785974400, 0, 'leisure-style', 'q-leisure-style-03', 1, 2),
  ('dq-leisure-style-04', 1785974400, 1785974400, 0, 'leisure-style', 'q-leisure-style-04', 1, 3),
  ('dq-leisure-style-05', 1785974400, 1785974400, 0, 'leisure-style', 'q-leisure-style-05', 1, 4),
  ('dq-leisure-style-06', 1785974400, 1785974400, 0, 'leisure-style', 'q-leisure-style-06', 1, 5),
  ('dq-leisure-style-07', 1785974400, 1785974400, 0, 'leisure-style', 'q-leisure-style-07', 1, 6),
  ('dq-leisure-style-08', 1785974400, 1785974400, 0, 'leisure-style', 'q-leisure-style-08', 1, 7),
  ('dq-leisure-style-09', 1785974400, 1785974400, 0, 'leisure-style', 'q-leisure-style-09', 1, 8),
  ('dq-leisure-style-10', 1785974400, 1785974400, 0, 'leisure-style', 'q-leisure-style-10', 1, 9),
  ('dq-time-planning-01', 1785974400, 1785974400, 0, 'time-planning', 'q-time-planning-01', 1, 0),
  ('dq-time-planning-02', 1785974400, 1785974400, 0, 'time-planning', 'q-time-planning-02', 1, 1),
  ('dq-time-planning-03', 1785974400, 1785974400, 0, 'time-planning', 'q-time-planning-03', 1, 2),
  ('dq-time-planning-04', 1785974400, 1785974400, 0, 'time-planning', 'q-time-planning-04', 1, 3),
  ('dq-time-planning-05', 1785974400, 1785974400, 0, 'time-planning', 'q-time-planning-05', 1, 4),
  ('dq-time-planning-06', 1785974400, 1785974400, 0, 'time-planning', 'q-time-planning-06', 1, 5),
  ('dq-time-planning-07', 1785974400, 1785974400, 0, 'time-planning', 'q-time-planning-07', 1, 6),
  ('dq-time-planning-08', 1785974400, 1785974400, 0, 'time-planning', 'q-time-planning-08', 1, 7),
  ('dq-time-planning-09', 1785974400, 1785974400, 0, 'time-planning', 'q-time-planning-09', 1, 8),
  ('dq-time-planning-10', 1785974400, 1785974400, 0, 'time-planning', 'q-time-planning-10', 1, 9),
  ('dq-conversation-emotion-01', 1786233600, 1786233600, 0, 'conversation-emotion', 'q-conversation-emotion-01', 1, 0),
  ('dq-conversation-emotion-02', 1786233600, 1786233600, 0, 'conversation-emotion', 'q-conversation-emotion-02', 1, 1),
  ('dq-conversation-emotion-03', 1786233600, 1786233600, 0, 'conversation-emotion', 'q-conversation-emotion-03', 1, 2),
  ('dq-conversation-emotion-04', 1786233600, 1786233600, 0, 'conversation-emotion', 'q-conversation-emotion-04', 1, 3),
  ('dq-conversation-emotion-05', 1786233600, 1786233600, 0, 'conversation-emotion', 'q-conversation-emotion-05', 1, 4),
  ('dq-conversation-emotion-06', 1786233600, 1786233600, 0, 'conversation-emotion', 'q-conversation-emotion-06', 1, 5),
  ('dq-conversation-emotion-07', 1786233600, 1786233600, 0, 'conversation-emotion', 'q-conversation-emotion-07', 1, 6),
  ('dq-conversation-emotion-08', 1786233600, 1786233600, 0, 'conversation-emotion', 'q-conversation-emotion-08', 1, 7),
  ('dq-conversation-emotion-09', 1786233600, 1786233600, 0, 'conversation-emotion', 'q-conversation-emotion-09', 1, 8),
  ('dq-conversation-emotion-10', 1786233600, 1786233600, 0, 'conversation-emotion', 'q-conversation-emotion-10', 1, 9);
--> statement-breakpoint

-- AccountDataがsnapshotを再同期するか判断する版。
-- このseedのcatalog内容を変更したら、必ずversionを1つ上げる。
INSERT INTO catalog_versions (catalog_id, version, updated_at) VALUES ('diagnosis', 2, 1786665600)
  ON CONFLICT(catalog_id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at;
--> statement-breakpoint

-- Expected result: diagnosis_count=5, question_version_count=50,
-- choice_count=100, diagnosis_question_count=50, scoring_config_count=5, catalog_version=2.
SELECT
  (SELECT COUNT(*) FROM diagnoses WHERE id IN ('relationship-priority', 'money-values', 'leisure-style', 'time-planning', 'conversation-emotion') AND state = 'published' AND description <> '' AND is_deleted = 0) AS diagnosis_count,
  (SELECT COUNT(*) FROM question_versions WHERE version = 1 AND state = 'approved' AND is_deleted = 0 AND (question_id LIKE 'q-relationship-priority-%' OR question_id LIKE 'q-money-%' OR question_id LIKE 'q-leisure-style-%' OR question_id LIKE 'q-time-planning-%' OR question_id LIKE 'q-conversation-emotion-%')) AS question_version_count,
  (SELECT COUNT(*) FROM question_choices WHERE question_version = 1 AND is_deleted = 0 AND (question_id LIKE 'q-relationship-priority-%' OR question_id LIKE 'q-money-%' OR question_id LIKE 'q-leisure-style-%' OR question_id LIKE 'q-time-planning-%' OR question_id LIKE 'q-conversation-emotion-%')) AS choice_count,
  (SELECT COUNT(*) FROM diagnosis_questions WHERE diagnosis_id IN ('relationship-priority', 'money-values', 'leisure-style', 'time-planning', 'conversation-emotion') AND is_deleted = 0) AS diagnosis_question_count,
  (SELECT COUNT(*) FROM diagnosis_scoring_configs WHERE id IN ('relationship-priority-v1', 'money-values-v1', 'leisure-style-v1', 'time-planning-v1', 'conversation-emotion-v1') AND version = 1 AND is_deleted = 0) AS scoring_config_count,
  (SELECT version FROM catalog_versions WHERE catalog_id = 'diagnosis') AS catalog_version;
