-- Phase 1 diagnosis catalog seed.
--
-- Apply the schema migrations before executing this file. This seed is intentionally
-- separate from Drizzle migrations because diagnosis content has its own
-- publication lifecycle. Existing published content is not updated. The only UPSERT
-- below fills the description column added after the initial seed, and only while empty.
-- Revise published content by adding a new Question Version and a new Diagnosis instead.
--
-- Timestamp: 2026-08-04T00:00:00.000Z (Unix seconds, as used by Drizzle timestamp mode).

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
  ('q-money-10', 1785801600, 1785801600, 0);
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
  (1785801600, 1785801600, 0, 'q-money-10', 1, 'approved', '家計を一緒にする場合でも、自由に使える個人のお金を残したい。', 'single_choice', 1785801600);
--> statement-breakpoint

INSERT OR IGNORE INTO question_choices (
  created_at,
  updated_at,
  is_deleted,
  question_id,
  question_version,
  choice_id,
  label,
  position,
  presentation
)
SELECT
  1785801600,
  1785801600,
  0,
  id,
  1,
  'no',
  'いいえ',
  0,
  '{"icon":"circle-x"}'
FROM questions
WHERE id IN (
  'q-relationship-priority-01', 'q-relationship-priority-02',
  'q-relationship-priority-03', 'q-relationship-priority-04',
  'q-relationship-priority-05', 'q-relationship-priority-06',
  'q-relationship-priority-07', 'q-relationship-priority-08',
  'q-relationship-priority-09', 'q-relationship-priority-10',
  'q-money-01', 'q-money-02', 'q-money-03', 'q-money-04', 'q-money-05',
  'q-money-06', 'q-money-07', 'q-money-08', 'q-money-09', 'q-money-10'
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
  position,
  presentation
)
SELECT
  1785801600,
  1785801600,
  0,
  id,
  1,
  'yes',
  'はい',
  1,
  '{"icon":"circle-check"}'
FROM questions
WHERE id IN (
  'q-relationship-priority-01', 'q-relationship-priority-02',
  'q-relationship-priority-03', 'q-relationship-priority-04',
  'q-relationship-priority-05', 'q-relationship-priority-06',
  'q-relationship-priority-07', 'q-relationship-priority-08',
  'q-relationship-priority-09', 'q-relationship-priority-10',
  'q-money-01', 'q-money-02', 'q-money-03', 'q-money-04', 'q-money-05',
  'q-money-06', 'q-money-07', 'q-money-08', 'q-money-09', 'q-money-10'
);
--> statement-breakpoint

INSERT INTO diagnoses (
  id,
  created_at,
  updated_at,
  is_deleted,
  title,
  description,
  opens_at,
  state,
  published_at
) VALUES
  ('relationship-priority', 1785801600, 1785801600, 0, '自分と相手の優先・境界線', '頼まれごとや意思決定で、自分と相手をどう尊重するかを見ます。', 1785801600, 'published', 1785801600),
  ('money-values', 1785801600, 1785801600, 0, 'お金と消費', '貯蓄、支出、共有、公平性、リスクに関する傾向を見ます。', 1785801600, 'published', 1785801600)
ON CONFLICT(id) DO UPDATE SET
  description = excluded.description
WHERE diagnoses.description = '';
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
  ('dq-money-10', 1785801600, 1785801600, 0, 'money-values', 'q-money-10', 1, 9);
--> statement-breakpoint

-- Expected result: diagnosis_count=2, question_version_count=20,
-- choice_count=40, diagnosis_question_count=20.
SELECT
  (SELECT COUNT(*) FROM diagnoses WHERE id IN ('relationship-priority', 'money-values') AND state = 'published' AND description <> '' AND is_deleted = 0) AS diagnosis_count,
  (SELECT COUNT(*) FROM question_versions WHERE version = 1 AND state = 'approved' AND is_deleted = 0 AND (question_id LIKE 'q-relationship-priority-%' OR question_id LIKE 'q-money-%')) AS question_version_count,
  (SELECT COUNT(*) FROM question_choices WHERE question_version = 1 AND is_deleted = 0 AND (question_id LIKE 'q-relationship-priority-%' OR question_id LIKE 'q-money-%')) AS choice_count,
  (SELECT COUNT(*) FROM diagnosis_questions WHERE diagnosis_id IN ('relationship-priority', 'money-values') AND is_deleted = 0) AS diagnosis_question_count;
