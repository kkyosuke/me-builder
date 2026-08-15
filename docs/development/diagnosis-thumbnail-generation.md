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
├── family-support-style.jpg
├── friendship-style.jpg
├── decision-making-style.jpg
├── work-priority-style.jpg
└── family-expectation-choice.jpg
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

## 10. 「友達との距離感・付き合い方」生成プロンプト

```text
Use case: stylized-concept
Asset type: 16:9 diagnosis card thumbnail for a web application
Primary request: Create a polished 3D paper-cut/clay-style illustration representing different ways friends stay connected: starting a conversation, planning time together, sharing worries, introducing friend circles, and talking through uncomfortable moments.
Scene/backdrop: A calm abstract social space with exactly two equal rounded friends seated face-to-face on the same horizontal baseline. Balanced communication arcs, blank planning tiles, a small shared speech form, and separate circles that can gently connect suggest the different friendship choices without favoring one approach.
Subject: Exactly two mirror-balanced abstract friend figures with equal head diameter, body size, pose, vertical position, and visual weight. Use different palette colors only. Neither figure should lead, follow, support, or depend on the other.
Style/medium: Soft layered 3D paper-cut / clay render matching a premium editorial app illustration.
Composition/framing: Wide 16:9, centered, clear silhouettes, important objects away from edges, suitable for a small card crop.
Lighting/mood: Warm soft studio lighting, relaxed, open, respectful, welcoming.
Color palette: Deep navy background, muted slate blue, warm cream, coral accents, small golden accents; consistent with the existing me-builder diagnosis thumbnails.
Materials/textures: Matte paper and soft clay, subtle depth and shadows.
Constraints: Exactly two equal figures. No third figure. No text, no letters, no numbers, no logos, no watermark, no brand marks, no hearts, no romantic symbols. Do not assign ages, genders, hierarchy, or fixed social roles. Do not make frequent contact, waiting for a reason, advance planning, spontaneity, sharing worries, privacy, connecting friend circles, keeping circles separate, immediate discussion, or taking time to reflect look superior.
```

## 11. 「決め方・迷いとの向き合い方」生成プロンプト

```text
Use case: stylized-concept
Asset type: 16:9 diagnosis card thumbnail for a web application
Primary request: Create a polished 3D paper-cut/clay-style illustration representing different ways of making a decision: comparing information, deciding early or near a deadline, using intuition or explicit reasons, asking for input, and reconsidering after new information.
Scene/backdrop: A calm abstract decision space with a central rounded junction and two equally inviting branching paths that gently reconnect. Balanced blank review cards, a simple hourglass without numbers, a small glowing intuition pebble, a neutral speech form, and a looping route marker suggest the five decision approaches without favoring one.
Subject: An abstract decision landscape made from balanced symbolic objects; no people required. The two paths must have equal width, lighting, prominence, and visual weight, and neither should appear to be the correct destination.
Style/medium: Soft layered 3D paper-cut / clay render matching a premium editorial app illustration.
Composition/framing: Wide 16:9, centered, clear silhouettes, important objects away from edges, suitable for a small card crop.
Lighting/mood: Warm soft studio lighting, calm, reflective, open, reassuring.
Color palette: Deep navy background, muted slate blue, warm cream, coral accents, small golden accents; consistent with the existing me-builder diagnosis thumbnails.
Materials/textures: Matte paper and soft clay, subtle depth and shadows.
Constraints: No text, no letters, no numbers, no logos, no watermark, no brand marks. Do not make more research, quick decisions, waiting, intuition, explicit reasoning, asking others, deciding independently, reconsidering, or staying with a decision look superior. Avoid scales, rankings, checkmarks, crosses, trophies, or a single highlighted correct path.
```

## 12. 「仕事の進め方・優先順位」生成プロンプト

```text
Use case: stylized-concept
Asset type: 16:9 diagnosis card thumbnail for a web application
Primary request: Create a polished 3D paper-cut/clay-style illustration representing different ways of organizing work: choosing a stopping point for quality, handling tasks sequentially or in parallel, using deadline time, reprioritizing after a new request, and sharing work in progress.
Scene/backdrop: A calm abstract workspace with two equally prominent task paths arranged around a central blank work surface. One path uses a single layered task stack while the other uses two balanced parallel task cards. A simple hourglass without numbers, movable blank planning tiles, and a gentle outgoing progress arc suggest deadlines, reprioritization, and sharing without favoring one approach.
Subject: An abstract work-planning landscape made from balanced task cards, layered paper shapes, an hourglass, movable planning tiles, and a neutral progress-sharing arc; no people required. Sequential and parallel arrangements must have equal size, lighting, prominence, and visual weight.
Style/medium: Soft layered 3D paper-cut / clay render matching a premium editorial app illustration.
Composition/framing: Wide 16:9, centered, clear silhouettes, important objects away from edges, suitable for a small card crop.
Lighting/mood: Warm soft studio lighting, calm, capable, thoughtful, welcoming.
Color palette: Deep navy background, muted slate blue, warm cream, coral accents, small golden accents; consistent with the existing me-builder diagnosis thumbnails.
Materials/textures: Matte paper and soft clay, subtle depth and shadows.
Constraints: No text, no letters, no numbers, no logos, no watermark, no brand marks. Do not make speed, refinement, sequential work, parallel work, early submission, using the available time, reprioritizing, keeping a plan, early sharing, or sharing after work takes shape look superior. Avoid rankings, checkmarks, crosses, trophies, corporate logos, realistic office signage, religious imagery, or political symbols.
```

## 13. 「家族の期待と自分の選択」生成プロンプト

最初のプロンプトで生成後、両側の色と明るさを均等にし、共通スタイルの背景へ揃える調整を行います。

```text
Use case: stylized-concept
Asset type: 16:9 diagnosis card thumbnail for a web application
Primary request: Create a polished neutral illustration representing how a person balances family expectations with their own choices about advice, education or career direction, work changes, relationships, and where to live.
Scene/backdrop: A calm abstract decision landscape with a central blank circular platform and two equally prominent open paths. One path is accompanied by a small inclusive cluster of varied abstract family tokens around an open conversation circle; the other is accompanied by a single neutral decision token and a blank compass-like shape. Place balanced blank route tiles suggesting study, work, close relationships, and location around the platform without text or recognizable symbols.
Subject: Abstract family and individual choice tokens, an open conversation circle, balanced branching paths, blank planning tiles, a small house-like form and a location marker-like form. The family-supported path and self-directed path must have equal size, lighting, prominence, openness, and visual weight.
Style/medium: Soft layered 3D paper-cut and clay render matching a premium editorial app illustration.
Composition/framing: Wide 16:9, centered, clear silhouettes, important objects away from edges, suitable for a small card crop.
Lighting/mood: Warm soft studio lighting, calm, respectful, thoughtful, welcoming.
Color palette: Deep navy background, muted slate blue, warm cream, coral accents, small golden accents; consistent with the existing me-builder diagnosis thumbnails.
Materials/textures: Matte paper and soft clay, subtle depth and shadows.
Constraints: No text, no letters, no numbers, no logos, no watermark, no brand marks. Do not imply a specific family structure, gender, age, marriage status, cohabitation, or culture. Do not make following family expectations or making an independent choice look safer, happier, more successful, more moral, or superior. Avoid rankings, checkmarks, crosses, trophies, chains, barriers, conflict imagery, corporate logos, realistic signage, religious imagery, or political symbols.
```

中立性を調整したプロンプトは次のとおりです。

```text
Edit the generated diagnosis thumbnail with one targeted change only: rebalance the two choice paths so the family-conversation side and the individual-choice side have the same warm-neutral color temperature, overall brightness, contrast, saturation, visual prominence, open space, and perceived emotional tone. Mix the muted slate blue, warm cream, coral, and small golden accents evenly across both sides instead of assigning warm colors to one path and cool dark colors to the other. Keep the central blank platform, family token group, individual token, house form, location marker, compass, branching paths, blank tiles, 16:9 framing, matte paper/clay style, and all object positions essentially unchanged. Both paths must look equally welcoming and equally valid. Preserve all constraints: no text, letters, numbers, logos, watermark, rankings, checkmarks, crosses, trophies, chains, barriers, conflict imagery, specific family structure, gender, age, culture, religion, or politics.
```

背景を共通スタイルへ揃えた最終プロンプトは次のとおりです。

```text
Edit the current diagnosis thumbnail with one targeted change only: change only the outer background and distant negative-space backdrop to a rich deep navy, matching the existing me-builder diagnosis thumbnail background style. Keep both branching path surfaces warm-neutral and identically balanced. Preserve every object, position, shape, scale, lighting relationship, 16:9 framing, and matte paper/clay texture. The family-conversation side and individual-choice side must remain equal in brightness, color temperature, saturation, contrast, visual prominence, open space, and emotional tone. Do not darken one side more than the other. Preserve all constraints: no text, letters, numbers, logos, watermark, rankings, checkmarks, crosses, trophies, chains, barriers, conflict imagery, specific family structure, gender, age, culture, religion, or politics.
```

## 14. 新しい診断へ展開する手順

1. §4の`Primary request`、`Scene/backdrop`、`Subject`を新しい診断のテーマへ置き換える
2. §3の共通スタイルと`Composition/framing`、`Constraints`を維持する
3. 生成物を16:9のJPEGとしてDiagnosis IDのファイル名で配置する
4. 小さいカード表示でも主題を判別でき、文字や透かしがないことを確認する
5. Web UIの対応表とサムネイル表示テストを更新する
