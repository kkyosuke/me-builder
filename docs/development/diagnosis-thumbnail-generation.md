# 診断サムネイル生成

## 1. この文書の目的

この文書は、診断一覧で使用する画像サムネイルの生成プロンプトと配置方法を所有します。

診断一覧の画面要件は[Phase 1 診断体験設計](../diagnosis/diagnosis-experience.md)、診断内容と質問は[人間関係の価値観 Yes／No質問集](../diagnosis/content/relationship-values-yes-no-question-bank.md)を正とします。この文書は、画面レイアウト、診断内容、採点方法を所有しません。

## 2. 配置と参照

生成した画像は`apps/web/public/images/diagnoses/<Diagnosis ID>.jpg`へ配置し、Web UIの診断IDと画像パスの対応へ追加します。カードで16:9表示するため、重要な被写体は画像中央へ置き、端に寄せません。

```text
apps/web/public/images/diagnoses/
├── default.jpg
├── relationship-priority.jpg
├── money-values.jpg
├── leisure-style.jpg
├── time-planning.jpg
├── conversation-emotion.jpg
├── life-priorities.jpg
├── work-values.jpg
├── work-relationship-style.jpg
└── family-support-style.jpg
```

## 3. 共通スタイル

- 16:9の横長構図
- 深いネイビーの背景
- スレートブルー、暖かいクリーム、コーラル、少量のゴールド
- マットな紙または柔らかなクレイの質感を持つ、立体的なペーパーカット表現
- 柔らかなスタジオ照明と穏やかな雰囲気
- 文字、ロゴ、透かし、ブランド記号を含めない

## 4. 「時間と予定」生成プロンプト

次のプロンプトを画像生成モデルへそのまま渡します。モデル側で指定できる場合は16:9を選びます。

```text
Use case: stylized-concept
Asset type: 16:9 diagnosis card thumbnail for a web application
Primary request: Create a polished 3D paper-cut/clay-style illustration representing time, schedules, advance planning, spontaneous changes, and shared time.
Scene/backdrop: A calm abstract planning scene with a large central clock, a simple calendar made only of blank tiles, and two gently branching paths that reconnect, suggesting both planned and flexible ways of spending time.
Subject: A balanced relationship between a clock, calendar, route markers, and two matching seats or cups that suggest making time together; no people required.
Style/medium: Soft layered 3D paper-cut / clay render matching a premium editorial app illustration.
Composition/framing: Wide 16:9, centered, clear silhouettes, important objects away from edges, suitable for a small card crop.
Lighting/mood: Warm soft studio lighting, calm, cooperative, welcoming.
Color palette: Deep navy background, muted slate blue, warm cream, coral accents, small golden accents; consistent with the existing me-builder diagnosis thumbnails.
Materials/textures: Matte paper and soft clay, subtle depth and shadows.
Constraints: No text, no letters, no numbers, no logos, no watermark, no brand marks. Do not show readable calendar dates. Avoid making planning or spontaneity look superior.
```

## 5. 「会話と感情表現」生成プロンプト

```text
Use case: stylized-concept
Asset type: 16:9 diagnosis card thumbnail for a web application
Primary request: Create a polished 3D paper-cut/clay-style illustration representing conversation, emotional expression, empathy, attentive listening, and sharing feelings in a close relationship.
Scene/backdrop: A calm abstract communication scene with two balanced speech bubbles facing each other, a softly glowing heart-shaped form between them, and gentle layered wave shapes suggesting listening and emotional exchange.
Subject: Two equal abstract figures or matching seats in conversation, with balanced speech bubbles and subtle symbols of listening and emotional sharing; neither side should dominate; no realistic people required.
Style/medium: Soft layered 3D paper-cut / clay render matching a premium editorial app illustration.
Composition/framing: Wide 16:9, centered, clear silhouettes, important objects away from edges, suitable for a small card crop.
Lighting/mood: Warm soft studio lighting, calm, empathetic, welcoming.
Color palette: Deep navy background, muted slate blue, warm cream, coral accents, small golden accents; consistent with the existing me-builder diagnosis thumbnails.
Materials/textures: Matte paper and soft clay, subtle depth and shadows.
Constraints: No text, no letters, no numbers, no logos, no watermark, no brand marks. Avoid making verbal expression, quiet support, advice, or empathy look superior to another communication style.
```

## 6. 「優先順位と人生の方向性」生成プロンプト

```text
Use case: stylized-concept
Asset type: 16:9 diagnosis card thumbnail for a web application
Primary request: Create a polished 3D paper-cut/clay-style illustration representing life priorities, personal direction, balancing stability with challenge, meaningful work, close relationships, personal wellbeing, and future preparation.
Scene/backdrop: A calm abstract scene with a central branching path that gently divides toward several equally weighted symbolic destinations and reconnects on the horizon, suggesting that priorities can change and coexist.
Subject: Balanced abstract symbols integrated around the path: a small sprouting plant for growth, a simple house for stability, a warm pair of matching circles or seats for close relationships, a subtle heart-and-leaf form for wellbeing, and a distant star for aspiration. Keep every symbol equal in visual weight; no people required.
Style/medium: Soft layered 3D paper-cut / clay render matching a premium editorial app illustration.
Composition/framing: Wide 16:9, centered, clear silhouettes, important objects away from edges, suitable for a small card crop.
Lighting/mood: Warm soft studio lighting, calm, reflective, hopeful, welcoming.
Color palette: Deep navy background, muted slate blue, warm cream, coral accents, small golden accents; consistent with the existing me-builder diagnosis thumbnails.
Materials/textures: Matte paper and soft clay, subtle depth and shadows.
Constraints: No text, no letters, no numbers, no logos, no watermark, no brand marks. Do not make stability, challenge, work, relationships, wellbeing, or preparation look superior to another. Avoid scales, rankings, trophies, money symbols, corporate logos, religious imagery, or political symbols.
```

## 7. 「仕事の価値観・働き方」生成プロンプト

```text
Use case: stylized-concept
Asset type: 16:9 diagnosis card thumbnail for a web application
Primary request: Create a polished 3D paper-cut/clay-style illustration representing work values and working style: autonomy, growth, compensation, stability, and boundaries between work and personal life.
Scene/backdrop: A calm abstract workspace with a central simple desk and five equally weighted visual directions arranged around it, suggesting that different work priorities can coexist.
Subject: Balanced abstract symbols integrated around the workspace: adjustable modular pieces for autonomy, rising steps with a small sprout for growth, plain golden disks without currency marks for compensation, a steady anchor-like base for stability, and a clock beside a small home-and-leaf form for work-life boundaries. Keep every symbol equal in visual weight; no people required.
Style/medium: Soft layered 3D paper-cut / clay render matching a premium editorial app illustration.
Composition/framing: Wide 16:9, centered, clear silhouettes, important objects away from edges, suitable for a small card crop.
Lighting/mood: Warm soft studio lighting, calm, thoughtful, capable, welcoming.
Color palette: Deep navy background, muted slate blue, warm cream, coral accents, small golden accents; consistent with the existing me-builder diagnosis thumbnails.
Materials/textures: Matte paper and soft clay, subtle depth and shadows.
Constraints: No text, no letters, no numbers, no logos, no watermark, no brand marks, no currency symbols. Do not make autonomy, growth, compensation, stability, or personal-life boundaries look superior to another. Avoid corporate logos, rankings, trophies, realistic money, religious imagery, or political symbols.
```

## 8. 「仕事の変化・周囲との関わり方」生成プロンプト

```text
Use case: stylized-concept
Asset type: 16:9 diagnosis card thumbnail for a web application
Primary request: Create a polished 3D paper-cut/clay-style illustration representing desire for change in work and different ways of relating to people at work: everyday distance, autonomy, feedback, and expressing a different opinion.
Scene/backdrop: A calm abstract workplace with two equal abstract coworkers facing each other across a simple desk. Around them, balanced branching task cards suggest staying with a familiar task or trying a new one, while speech bubbles and gentle connection lines suggest different communication distances.
Subject: Two equal abstract workplace figures, neither dominant and with no hierarchy, with modular task shapes, one close and one wider communication arc, a small feedback loop, and two diverging speech forms that remain connected. Keep every symbol equal in visual weight.
Style/medium: Soft layered 3D paper-cut / clay render matching a premium editorial app illustration.
Composition/framing: Wide 16:9, centered, clear silhouettes, important objects away from edges, suitable for a small card crop.
Lighting/mood: Warm soft studio lighting, calm, respectful, thoughtful, welcoming.
Color palette: Deep navy background, muted slate blue, warm cream, coral accents, small golden accents; consistent with the existing me-builder diagnosis thumbnails.
Materials/textures: Matte paper and soft clay, subtle depth and shadows.
Constraints: No text, no letters, no numbers, no logos, no watermark, no brand marks. Do not make either figure look more powerful or superior. Avoid corporate logos, rankings, trophies, realistic office signage, religious imagery, or political symbols.
```

## 9. 「家族との距離感・支え合い」生成プロンプト

```text
Use case: stylized-concept
Asset type: 16:9 diagnosis card thumbnail for a web application
Primary request: Create a polished 3D paper-cut/clay-style illustration representing different ways family members stay connected and support one another: contact, sharing worries, listening or offering practical help, resolving disagreements, and planning shared time.
Scene/backdrop: A calm abstract home-like space with exactly two identical rounded figures seated face-to-face on the same horizontal baseline, connected by balanced arcs at close and wider distances. A simple glowing house outline is centered behind them. Balanced speech bubbles, an open hand-like support form, a pause-and-reconnect loop, and blank planning tiles suggest the different interactions without favoring one approach.
Subject: Exactly two mirror-symmetric abstract family figures with equal head diameter, body size, pose, vertical position, and visual weight. Use different palette colors only. Neither figure should lead or depend on another, and neither should imply a fixed family role.
Style/medium: Soft layered 3D paper-cut / clay render matching a premium editorial app illustration.
Composition/framing: Wide 16:9, centered, clear silhouettes, important objects away from edges, suitable for a small card crop.
Lighting/mood: Warm soft studio lighting, calm, caring, respectful, welcoming.
Color palette: Deep navy background, muted slate blue, warm cream, coral accents, small golden accents; consistent with the existing me-builder diagnosis thumbnails.
Materials/textures: Matte paper and soft clay, subtle depth and shadows.
Constraints: Exactly two equal figures. No third figure. No text, no letters, no numbers, no logos, no watermark, no brand marks. Do not depict a stereotyped nuclear family or assign size differences, fixed ages, genders, hierarchy, or roles. Do not make frequent contact, privacy, listening, practical help, immediate discussion, waiting, advance planning, or flexibility look superior.
```

## 10. 新しい診断へ展開する手順

1. §4の`Primary request`、`Scene/backdrop`、`Subject`を新しい診断のテーマへ置き換える
2. §3の共通スタイルと`Composition/framing`、`Constraints`を維持する
3. 生成物を16:9のJPEGとしてDiagnosis IDのファイル名で配置する
4. 小さいカード表示でも主題を判別でき、文字や透かしがないことを確認する
5. Web UIの対応表とサムネイル表示テストを更新する
