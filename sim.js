/* =====================================================================
 * sim.js — cmd_549「多局面（ビート）連鎖 × 軽いストーリー（推理の手がかり）」
 *           ★ cmd_548（複数ステージ × 遊び幅）の上に、1ステージを複数局面の連鎖にし、
 *             1本の長いタイムライン計画で段階クリアする構造を載せた版（DOM非依存の決定論コア）。
 *
 * ◆ cmd_548 → cmd_549 の差分（ふつくんとの壁打ち反映 2点）
 *   (1) 「今のPoCは1局面1計画で短く手応えが薄い。Timelie的に“複数局面（ビート）の連鎖”を
 *       1本の長い計画で段階クリアしたい」
 *       → ステージを **局面（beats[]）の連鎖** にした。1ステージ＝複数ビート。
 *         travel（移動/穴ジャンプ/到達）と ghost（お化けの間合い・信頼）を交互に並べ、
 *         **1本の計画**で beat0→beat1→…→final まで順に攻略する。
 *         beat の進行管理は simulatePlan の外側ロジックで行い、**step() の物理は一切触らない**。
 *   (2) 「子供おばけに“何を試せばいいか”推理する材料が無い。軽いストーリー/会話で手がかりを」
 *       → 各ステージに **intro（ステージ前の短い会話）** と、各 beat に **banner/clue（道中メッセージ）** を持たせた。
 *         会話・メッセージは『このお化けには何が効くか（間合いの取り方／しゃがむ／待つ）』の **推理の手がかり**。
 *       → ★cmd_544の教訓: 当時は手がかりが画面に出ずネタバレYAMLだけ→推理が“数字読み”に退化。
 *         今回は (a)手がかりを **画面に提示**（intro modal＋道中 banner/clue。描画は game.js）
 *                (b)ただし **正解を一行で直書きせず**、性格づけで“察させる”（例「詰め寄ると縮こまる」→距離を保つ&しゃがむ を察する）。
 *
 * ◆ 多局面の“深さ”は局面連鎖＋文脈で出す（行動カードの語彙は増やさない）
 *   - カード種は cmd_547 から不変（→ / ← / ジャンプ / しゃがむ / 待つ）。新しい動詞は足さない。
 *   - 代わりに **お化けごとに性格（間合い feel）が逆** という“文脈”で、同じ「しゃがむ」でも
 *     **どこで止まってしゃがむか（間合いの読み）** が変わる。手がかりがその読みのヒントになる。
 *       例: すねん坊（間合い広・過敏）＝遠めで止まってしゃがむ／さみしがり（間合い狭・寄ってほしい）＝近くでしゃがむ。
 *
 * ◆ 何を "壊さず" 引き継いだか（cmd_545/546/547/548 のコア）
 *   - step() の物理・間合い・信頼・しゃがみ逆説・ソフト失敗・phase 判定・勝利判定は **cmd_548 と一字一句同じ**。
 *       多局面化は **simulatePlan 内の beat 進行管理** と **applyBeat（局面ごとに お化け位置/間合い/クリア窓/穴を差し替え）**
 *       だけで実現。step() は1行も変えていない。
 *   - 固定マスカード（1枚=固定量・距離はカード枚数）／拡大グリッド（GRID=10）／決定論 tape 方式
 *       （先読み=再生が必ず一致）／到達セル一意／複数ステージ＋遊び幅（クリア窓）は全て維持。
 *   - cmd_548 で「ステージ＝1要素」だったのを「ステージ＝beats[] を持つ1要素」に拡張しただけ。
 *       単一お化けステージ（①〜④）は **beats が1個（ghost・final）** の特殊形＝cmd_548と同一挙動。
 *
 * 決定論: step() は Math.random / Date を一切使わない。beat 進行も state 依存で決定論。node からも require 可（末尾UMD）。
 * ===================================================================== */

(function (root) {
  'use strict';

  // ===== 物理定数（cmd_545→548 から不変。ステージ/局面で変えない＝手触りの土台）=====
  var DT = 1 / 60;                  // 固定タイムステップ（決定論の要）
  var GROUND_Y = 0;                 // 接地の y

  // --- グリッド（cmd_547 の拡大マスを維持：GRID=10）---
  var GRID = 10;                    // 1マスの幅[world unit]。マス数は面の X 幅で決まる
  var BEAT_FRAMES = 60;             // 1拍 = 60フレーム = 1.0秒（待つ/しゃがむの離散単位）

  // --- 固定カード（cmd_547 の主題を維持：1枚=固定量。距離はカード枚数で）---
  var MOVE_CELLS = 1;               // 移動カード1枚 = ちょうど 1 マス
  var FIXED_BEATS = { crouch: 2, wait: 2 };  // 待つ/しゃがむ1枚 = 固定 2 拍

  // --- 主人公（移動が主役）---
  var PLAYER_SPEED = 34;
  var PLAYER_ACCEL = 0.30;
  var STILL_EPS = 6;

  // --- ジャンプ ---
  var JUMP_V = 46;
  var GRAVITY = 130;
  var HOP_VX = 30;
  var EDGE = 0.6;

  // --- お化けの移動 ---
  var GHOST_SPEED = 17;
  var GHOST_ACCEL = 0.16;

  // --- 警戒/信頼の速度レート（cmd_545 物理。ステージで変えない）---
  var COMFORT_NEAR = 4;
  var ADJACENT_BASE = 9;            // cmd_547 既定（局面で上書き）

  var TRUST_WIN_BASE = 80;          // cmd_547 既定（局面で上書き）
  var WARY_MAX  = 100;
  var VIEW = 60;

  var WARY_STAND   = 64;
  var WARY_RUSH    = 36;
  var WARY_DEEP_CROUCH = 16;
  var CALM_RATE_STAND  = 16;
  var CALM_RATE_CROUCH = 30;

  var TRUST_RATE    = 15;
  var TRUST_FARMUL  = 0.35;
  var TRUST_EROSION = 9;
  var TRUST_WARY_GATE = 50;
  var DEEP_PEN = 0.6;

  var APPROACH_WARY_GATE = 36;
  var CLOSED_TIME = 1.3;
  var CLOSED_TRUST_DROP = 30;

  // --- コンパイラ（固定カード→tape）の安全弁 ---
  var SAFE_FRAMES_MOVE = 900;
  var SAFE_FRAMES_JUMP = 240;
  var STUCK_LIMIT = 18;
  var STUCK_EPS = 0.05;

  // =====================================================================
  // ★ 局面（ビート）系の値（cmd_548 のステージ変数を「局面ごとに差し替え」へ拡張）
  //    loadStage() がステージ全体（床幅・初期セル）を、applyBeat() が局面ごとの
  //    お化け位置/間合い/クリア窓/穴 を書き換える。step() はこれらを参照するだけ（コードは cmd_548 と不変）。
  // =====================================================================
  var X_MIN = 4, X_MAX = 124;        // 床の左右端（ステージ単位）
  var PLAYER_START = 14;             // 主人公の初期 x（ステージ単位）
  var GHOST_START  = 104;            // お化けの初期 x（描画の既定。実体は applyBeat が設定）
  var GAP_L = 28, GAP_R = 37;        // 穴（ピット）。今アクティブな局面の穴。穴なしは範囲外へ退避
  var MAXCELL = Math.round((X_MAX - X_MIN) / GRID);

  // 間合い（お化けが守りたい距離。局面で変えると "シビアさ/性格" が変わる）
  var COMFORT_FAR  = 26;
  var SPACE_MARGIN = 10;

  // ★ クリア窓（遊び幅）。局面ごとに緩め幅を変える。
  var ADJACENT = ADJACENT_BASE;      // 隣接とみなす距離（広い=易）
  var TRUST_WIN = TRUST_WIN_BASE;    // 必要な信頼（低い=易）
  var WIN_WARY_GATE = 30;            // 勝利を許す警戒の上限（高い=易, 既定30=cmd_547同一）

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function sign(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }

  // ★ グリッド⇔座標（X_MIN/MAXCELL は今のステージ依存）
  function cellToX(c) { return clamp(X_MIN + c * GRID, X_MIN, X_MAX); }
  function xToCell(x) { return clamp(Math.round((x - X_MIN) / GRID), 0, MAXCELL); }

  // =====================================================================
  // ★ ステージ定義（データ）。cmd_548 の表に **beats[]（局面の連鎖）** と
  //   **intro（ステージ前会話）** を追加。Unity 移植時もこの表をそのまま持てる。
  //
  //   共通: id / name / blurb / geom{xMax, playerCell} / intro[] / beats[] / example[]
  //   intro[]: ステージ前の短い会話。{who, text}。性格/背景＋“推理の手がかり”（正解は直書きしない）。
  //   beats[]: 局面の連鎖。各局面は travel か ghost。
  //     travel: { kind:'travel', goalCell, gap:{cell}|null, banner, final? }
  //             — goalCell に到達したら次局面へ（穴ありなら越える）。お化け社交は無し。
  //     ghost : { kind:'ghost', ghostCell, feel:{comfortFar,spaceMargin}, win:{adjacent,trustWin,winWaryGate},
  //               gap:{cell}|null, name, banner, clue, final? }
  //             — そのお化けと隣り合えたら（信頼が育てば）次局面へ。final:true なら ステージ勝利。
  //   example[]: お手本（1本の計画＝カード種別の並び）。全局面を段階クリアして final win に到達する。
  //
  //   ★ 単一お化けステージ（①〜④）は beats が1個（ghost・final）＝ cmd_548 と同一挙動。
  // =====================================================================
  var STAGES = [
    {
      id: 'meeting',
      name: '① はじまりの庭（出会い）',
      blurb: '穴なし・間合いやさしめ。「立つ＝威圧／しゃがむ＝歩み寄り」の逆説に気づく練習。クリア窓は広め。',
      geom: { xMax: 104, playerCell: 1 },
      intro: [
        { who: '？？？', text: '…だれ？　ちかづかれると、ちょっと、こわい…' },
        { who: 'あなた', text: '（むりに見下ろすと身構えるみたい。低い姿勢で、そっと待ってみようか）' }
      ],
      beats: [
        { kind: 'ghost', ghostCell: 8, gap: null,
          feel: { comfortFar: 22, spaceMargin: 8 },
          win:  { adjacent: 13, trustWin: 64, winWaryGate: 42 },
          name: '庭のおばけ',
          banner: '小さなおばけが、こちらをうかがってる。',
          clue: '見下ろされるのが苦手。立って詰め寄らず、しゃがんで待ってみて。',
          final: true }
      ],
      example: ['right', 'right', 'right', 'crouch', 'crouch', 'crouch']
    },
    {
      id: 'rift',
      name: '② 月夜の裂け目（穴越え）',
      blurb: '穴をジャンプで越えてから近づく。間合い・クリア窓は標準。cmd_547 の手触りに近い基準面。',
      geom: { xMax: 124, playerCell: 1 },
      intro: [
        { who: '？？？', text: 'こっちに来るには、その裂け目を越えなきゃ。' },
        { who: 'あなた', text: '（穴は跳んで越える。渡ったあとは焦らず、間合いを計ろう）' }
      ],
      beats: [
        { kind: 'ghost', ghostCell: 10, gap: { cell: 3 },
          feel: { comfortFar: 26, spaceMargin: 10 },
          win:  { adjacent: 11, trustWin: 74, winWaryGate: 36 },
          name: '裂け目のおばけ',
          banner: '裂け目の向こうのおばけ。まずはジャンプで渡って。',
          clue: '渡ったら、立ったまま近づきすぎない。しゃがんで信頼を育てて。',
          final: true }
      ],
      example: ['right', 'jump', 'right', 'right', 'crouch', 'crouch', 'crouch', 'crouch']
    },
    {
      id: 'shy',
      name: '③ 臆病なおばけ（間合いシビア）',
      blurb: 'お化けが広い間合いを守る＝近づくと過敏。詰め寄りは即警戒。クリア窓は狭め＝丁寧なしゃがみが要る。',
      geom: { xMax: 124, playerCell: 1 },
      intro: [
        { who: '臆病なおばけ', text: '…っ！　そんなに、近づかないで……！' },
        { who: 'あなた', text: '（広いなわばりを持ってる子。踏み込みすぎず、遠めで落ち着けてあげたい）' }
      ],
      beats: [
        { kind: 'ghost', ghostCell: 11, gap: { cell: 3 },
          feel: { comfortFar: 30, spaceMargin: 12 },
          win:  { adjacent: 10, trustWin: 78, winWaryGate: 30 },
          name: '臆病なおばけ',
          banner: '臆病なおばけ。なわばりが広い＝近寄ると過敏。',
          clue: '詰め寄ると即こわがる。だいぶ手前で止まって、しゃがんで待って。',
          final: true }
      ],
      example: ['right', 'jump', 'right', 'crouch', 'crouch', 'crouch', 'crouch', 'crouch']
    },
    {
      id: 'far',
      name: '④ 遠い夜道（穴＋長い間合い）',
      blurb: '広い床を進み、穴を越えて遠くのお化けへ。移動は多いがクリア窓は中〜広。落ち着いて寄れば開く総まとめ面。',
      geom: { xMax: 144, playerCell: 1 },
      intro: [
        { who: '？？？', text: '…遠いところまで、よく来たね。' },
        { who: 'あなた', text: '（道のりは長い。落ち着いて寄れば、いつか隣に立てる）' }
      ],
      beats: [
        { kind: 'ghost', ghostCell: 13, gap: { cell: 4 },
          feel: { comfortFar: 26, spaceMargin: 10 },
          win:  { adjacent: 12, trustWin: 70, winWaryGate: 38 },
          name: '夜道のおばけ',
          banner: '長い夜道の先のおばけ。穴を越えて、落ち着いて寄って。',
          clue: '距離はあるけど焦らない。近づいたらしゃがんで、心が開くのを待って。',
          final: true }
      ],
      example: ['right', 'right', 'jump', 'right', 'right', 'right', 'crouch', 'crouch', 'crouch', 'crouch']
    },

    // ===================================================================
    // ⑤ ★ 多局面（ビート）連鎖ステージ（cmd_549 の主役）
    //    4局面: travel(穴ジャンプ) → ghost A 臆病/間合い広 → travel(穴ジャンプ) → ghost B 本命/間合い狭(final)
    //    1本の計画で beat0→beat3 まで段階クリアする。お化けA・Bは性格が“逆”で、
    //    手がかり（intro/banner/clue）を読むと「どこで止まってしゃがむか」が察せる。
    // ===================================================================
    {
      id: 'festival',
      name: '⑤ 夜祭りの二人（多局面）',
      blurb: '★多局面。橋を渡り、性格の違う二人のおばけと順に向き合う総合面。手前の子は“近づかれるのが苦手”、奥の子は“そばにいてほしい”。手がかりを読んで1本の計画で攻略。',
      geom: { xMax: 188, playerCell: 1 },
      intro: [
        { who: '案内のおばけ', text: '今夜は二人のおばけが、橋の先で待ってる。' },
        { who: '案内のおばけ', text: '手前の子は“すねん坊”。近づかれるのが苦手で、詰め寄るとすぐ縮こまる。' },
        { who: '案内のおばけ', text: '奥の子は“さみしがり”。ずっと独りぼっち。そばにいてくれる人を待ってる。' },
        { who: 'あなた', text: '（性格が逆みたい。手前は遠くから、奥は近くで…見極めて1本の計画を立てよう）' }
      ],
      beats: [
        // beat0: 橋（穴）をジャンプで渡る。お化けAを前方に望む。
        { kind: 'travel', goalCell: 5, gap: { cell: 4 },
          banner: '細い橋。むこうに“すねん坊”がうずくまってる。まずジャンプで渡って。' },
        // beat1: お化けA（すねん坊・間合い広・過敏）。遠めで止まってしゃがむ＝察し所。
        { kind: 'ghost', ghostCell: 9, gap: null,
          feel: { comfortFar: 30, spaceMargin: 12 },
          win:  { adjacent: 11, trustWin: 70, winWaryGate: 34 },
          name: 'すねん坊',
          banner: '“すねん坊”：…っ（びくっ）　— 近寄られるのが、こわい。',
          clue: '詰め寄ると縮こまる子。だいぶ手前で止まって、低く待ってみて。',
          final: false },
        // beat2: もう一つの裂け目をジャンプで渡る。本命Bへ。
        { kind: 'travel', goalCell: 13, gap: { cell: 12 },
          banner: '“すねん坊”が道をあけてくれた。次の裂け目を跳んで、奥の子へ。' },
        // beat3: 本命B（さみしがり・間合い狭・寄ってほしい）。近くで寄り添う＝察し所。final。
        { kind: 'ghost', ghostCell: 17, gap: null,
          feel: { comfortFar: 22, spaceMargin: 8 },
          win:  { adjacent: 12, trustWin: 70, winWaryGate: 42 },
          name: 'さみしがり',
          banner: '“さみしがり”：…いっしょに、いてくれる？',
          clue: 'そばにいてほしい子。今度はしっかり近づいて、隣でしゃがんで寄り添って。',
          final: true }
      ],
      // お手本（1本の計画）。beat0渡る→A遠めでしゃがむ→beat2渡る→B近くでしゃがむ。
      example: [
        'right', 'right', 'jump',                               // beat0: 橋を渡る（~cell5/6へ）
        'crouch', 'crouch', 'crouch', 'crouch', 'crouch',       // beat1: 手前(遠め)でしゃがんでA攻略
        'right', 'right', 'right', 'right', 'right', 'jump',     // beat2: 進んで二つ目の穴を渡る
        'right', 'right',                                       // 本命Bへ近づく
        'crouch', 'crouch', 'crouch', 'crouch', 'crouch'        // beat3: 近くでしゃがんでB攻略
      ]
    }
  ];

  var currentStageIndex = 0;

  // ★ ステージ全体（床幅・初期セル）をロード。局面ごとの値は applyBeat が後で差し替える。
  function loadStage(idx) {
    idx = clamp(idx | 0, 0, STAGES.length - 1);
    currentStageIndex = idx;
    var s = STAGES[idx];
    X_MIN = 4;
    X_MAX = s.geom.xMax;
    MAXCELL = Math.round((X_MAX - X_MIN) / GRID);
    PLAYER_START = cellToX(s.geom.playerCell);
    // 描画の既定: 最初の ghost 局面のお化け位置（無ければ床右端寄り）
    var fg = firstGhostBeat(s);
    GHOST_START = fg ? cellToX(fg.ghostCell) : X_MAX;
    // 既定の穴/間合い/クリア窓は beat0 を当てておく（draw のフォールバック用）
    applyBeatGeometry(s.beats[0]);
    var gb0 = (s.beats[0].kind === 'ghost') ? s.beats[0] : (fg || null);
    if (gb0) applyBeatFeel(gb0);
    return s;
  }
  function firstGhostBeat(s) {
    for (var i = 0; i < s.beats.length; i++) if (s.beats[i].kind === 'ghost') return s.beats[i];
    return null;
  }
  function nextGhostCellFrom(s, fromIdx) {
    for (var i = fromIdx; i < s.beats.length; i++) if (s.beats[i].kind === 'ghost') return s.beats[i].ghostCell;
    return null;
  }
  function currentStage() { return STAGES[currentStageIndex]; }
  function stageList() {
    return STAGES.map(function (s, i) {
      return { index: i, id: s.id, name: s.name, blurb: s.blurb, beatCount: s.beats.length,
               multibeat: s.beats.length >= 3 };
    });
  }
  // ステージ前会話・局面メタ（UI が画面提示するためのデータ取り出し）
  function stageIntro(idx) { return STAGES[clamp(idx | 0, 0, STAGES.length - 1)].intro || []; }
  function beatMeta(idx) {
    var s = STAGES[clamp(idx | 0, 0, STAGES.length - 1)];
    return s.beats.map(function (b, i) {
      return { index: i, kind: b.kind, name: b.name || null, banner: b.banner || '',
               clue: b.clue || '', final: !!b.final,
               goalCell: (b.kind === 'travel') ? b.goalCell : null,
               ghostCell: (b.kind === 'ghost') ? b.ghostCell : null };
    });
  }

  // ★ 局面の幾何（穴）を今のアクティブ状態へ
  function applyBeatGeometry(beat) {
    if (beat.gap) {
      // 穴は指定 cell 中心の周りを飲み込む。cmd_547 の cell3=34 で 28..37 の比率を踏襲
      // （中心 -6 .. +3）＝ジャンプ1枚（水平 ≒2マス）で確実に越える幅。歩いては渡れない。
      var center = X_MIN + beat.gap.cell * GRID;
      GAP_L = center - 6;
      GAP_R = center + 3;
    } else {
      GAP_L = X_MIN - 100;            // 穴なし：判定が絶対に成立しない範囲外へ退避
      GAP_R = X_MIN - 100;
    }
  }
  // ★ 局面の間合い/クリア窓を今のアクティブ状態へ（ghost 局面のみ）
  function applyBeatFeel(ghostBeat) {
    COMFORT_FAR   = ghostBeat.feel.comfortFar;
    SPACE_MARGIN  = ghostBeat.feel.spaceMargin;
    ADJACENT      = ghostBeat.win.adjacent;
    TRUST_WIN     = ghostBeat.win.trustWin;
    WIN_WARY_GATE = ghostBeat.win.winWaryGate;
  }

  // ★ 局面をロード（step物理は触らず、参照する変数とお化け位置・社交状態だけ差し替える）
  //   ghost 局面: お化けをその位置に置き、間合い/クリア窓をセット、社交状態（信頼/警戒）を新規にリセット。
  //   travel 局面: 穴をセット。お化けは「次に向き合う ghost のセル」に置いて前方に望ませる（社交は到達判定に影響しない）。
  function applyBeat(state, stage, beatIdx) {
    var b = stage.beats[beatIdx];
    applyBeatGeometry(b);
    // 社交状態を新規にリセット（局面ごとに別のお化けと向き合う＝関係はやり直し）
    state.wariness = 0;
    state.trust = 0;
    state.closedTimer = 0;
    state.result = null;
    state.ghostVel = 0;
    if (b.kind === 'ghost') {
      state.ghostX = cellToX(b.ghostCell);
      applyBeatFeel(b);
    } else {
      // travel: 次に出会う ghost を前方に望ませる（無ければ床右端へ退避）。間合いは緩く（干渉しない）。
      var ng = nextGhostCellFrom(stage, beatIdx + 1);
      state.ghostX = (ng != null) ? cellToX(ng) : X_MAX;
      // travel 中は社交が事実上 no-op になるよう、クリア窓は到達不能・間合いは最小に
      COMFORT_FAR = COMFORT_NEAR; SPACE_MARGIN = 0;
      ADJACENT = 0; TRUST_WIN = 999; WIN_WARY_GATE = 0;
    }
  }

  // 起動時に先頭ステージをロード（GAP_L 等を整える）
  loadStage(0);

  // ===== 初期状態（cmd_545 と同一。位置だけ今のステージ依存）=====
  function initialState() {
    return {
      t: 0,
      playerX: PLAYER_START, playerVel: 0,
      y: GROUND_Y, vy: 0, grounded: true,
      crouching: false,
      jumpLatch: false,
      ghostX: GHOST_START, ghostVel: 0,
      wariness: 0,
      trust: 0,
      closedTimer: 0,
      phase: 'calm',
      result: null,
      events: []
    };
  }

  function targetDistOf(trust) {
    return lerp(COMFORT_FAR, COMFORT_NEAR, clamp(trust, 0, 100) / 100);
  }
  function guardRadiusOf(trust) { return targetDistOf(trust) + SPACE_MARGIN; }

  function moveGhostToward(state, goal, dt) {
    var delta = goal - state.ghostX;
    var desiredVel = clamp(delta * 3, -GHOST_SPEED, GHOST_SPEED);
    state.ghostVel = lerp(state.ghostVel, desiredVel, GHOST_ACCEL);
    state.ghostX = clamp(state.ghostX + state.ghostVel * dt, X_MIN, X_MAX);
  }

  // ===== 1ステップ進める（★ cmd_545→548 から物理は不変。1行も変えていない）=====
  // input = { dir:-1|0|1, crouch:bool, jump:bool }
  function step(state, input, dt) {
    state.events = [];
    if (state.result === 'win') { return state; }

    input = input || {};
    var dir = input.dir | 0;
    var wantCrouch = !!input.crouch && state.grounded;

    var hopVx = 0;
    if (input.jump && state.grounded && state.closedTimer <= 0) {
      state.vy = JUMP_V;
      state.grounded = false;
      state.jumpLatch = true;
      state.events.push('jump');
    }
    if (!state.grounded) {
      state.vy -= GRAVITY * dt;
      state.y += state.vy * dt;
      hopVx = HOP_VX;
    }

    var crouchMul = (wantCrouch && state.grounded) ? 0 : 1;
    var baseSpeed = state.grounded ? PLAYER_SPEED * crouchMul : hopVx;
    var targetVel = (state.grounded ? dir : 1) * baseSpeed;
    if (state.closedTimer > 0) targetVel = 0;
    state.playerVel = lerp(state.playerVel, targetVel, PLAYER_ACCEL);
    var prevX = state.playerX;
    state.playerX = clamp(state.playerX + state.playerVel * dt, X_MIN, X_MAX);
    state.crouching = wantCrouch && state.grounded;

    if (!state.grounded && state.y <= GROUND_Y) {
      state.y = GROUND_Y; state.vy = 0; state.grounded = true; state.jumpLatch = false;
      state.events.push('land');
    }

    if (state.grounded && state.playerX > GAP_L && state.playerX < GAP_R) {
      if (prevX <= GAP_L + (GAP_R - GAP_L) / 2) state.playerX = GAP_L - EDGE;
      else state.playerX = GAP_R + EDGE;
      state.playerVel = 0;
    }

    var dist = Math.abs(state.ghostX - state.playerX);
    var dirAway = (state.ghostX >= state.playerX) ? 1 : -1;
    var targetDist = targetDistOf(state.trust);
    var space = targetDist + SPACE_MARGIN;
    var inside = dist < space;
    var penetration = inside ? (space - dist) / space : 0;
    var movingToward = (sign(state.playerVel) === dirAway) && (Math.abs(state.playerVel) > STILL_EPS);
    var still = Math.abs(state.playerVel) < STILL_EPS;

    if (state.closedTimer > 0) {
      state.closedTimer = Math.max(0, state.closedTimer - dt);
      var fleeTarget = clamp(state.playerX + dirAway * (space + 12), X_MIN, X_MAX);
      moveGhostToward(state, fleeTarget, dt);
      state.wariness = Math.max(40, state.wariness - 22 * dt);
      state.phase = 'closed';
      state.t += dt;
      if (state.closedTimer === 0) state.events.push('reopen');
      return state;
    }

    if (state.crouching) {
      if (still) {
        state.wariness -= CALM_RATE_CROUCH * dt;
        if (penetration > DEEP_PEN) state.wariness += WARY_DEEP_CROUCH * (penetration - DEEP_PEN) / (1 - DEEP_PEN) * dt;
      } else {
        if (inside) state.wariness += WARY_DEEP_CROUCH * penetration * dt;
        else state.wariness -= CALM_RATE_CROUCH * 0.5 * dt;
      }
    } else {
      if (inside) {
        state.wariness += WARY_STAND * penetration * dt;
        if (movingToward) state.wariness += WARY_RUSH * penetration * dt;
      } else {
        state.wariness -= CALM_RATE_STAND * dt;
      }
    }
    state.wariness = clamp(state.wariness, 0, WARY_MAX);

    if (state.crouching && still && penetration < DEEP_PEN && state.wariness < TRUST_WARY_GATE) {
      var farMul = (dist > VIEW) ? TRUST_FARMUL : 1;
      state.trust += TRUST_RATE * farMul * dt;
    } else if (!state.crouching && inside) {
      state.trust -= TRUST_EROSION * penetration * dt;
    }
    state.trust = clamp(state.trust, 0, 100);

    if (state.wariness >= WARY_MAX) {
      state.closedTimer = CLOSED_TIME;
      state.trust = Math.max(0, state.trust - CLOSED_TRUST_DROP);
      state.wariness = 55;
      state.events.push('closed');
      state.phase = 'closed';
      state.t += dt;
      return state;
    }

    var desiredDist;
    var canApproach = state.wariness < APPROACH_WARY_GATE;
    if (!state.crouching && inside) {
      desiredDist = Math.max(targetDist, dist + 10);
      canApproach = false;
    } else {
      desiredDist = targetDist;
    }
    var ghostGoal = clamp(state.playerX + dirAway * desiredDist, X_MIN, X_MAX);
    var movingCloser = Math.abs(ghostGoal - state.playerX) < dist - 1e-6;
    if (movingCloser && !canApproach) ghostGoal = state.ghostX;
    moveGhostToward(state, ghostGoal, dt);

    var dist2 = Math.abs(state.ghostX - state.playerX);
    // ★ クリア窓（遊び幅）：trustWin/adjacent/winWaryGate は局面依存。物理は不変。
    if (state.trust >= TRUST_WIN && dist2 <= ADJACENT && state.wariness < WIN_WARY_GATE && state.grounded) {
      state.result = 'win';
      state.phase = 'win';
      state.events.push('win');
      state.t += dt;
      return state;
    }

    state.phase = derivePhase(state, dist2);
    state.t += dt;
    return state;
  }

  function derivePhase(state, dist) {
    if (state.result === 'win') return 'win';
    if (state.closedTimer > 0) return 'closed';
    if (state.wariness >= 62) return 'scared';
    if (state.wariness >= 34) return 'wary';
    var toward = state.ghostVel * ((state.ghostX >= state.playerX) ? -1 : 1) > 0.4;
    if (toward && state.trust >= 50) return 'approaching';
    if (state.trust >= 20 && (toward || dist < VIEW)) return 'curious';
    return 'calm';
  }

  // ===== 行動ブロック（固定カード）の定義（cmd_547/548 と同一・語彙を増やさない）=====
  var BLOCK_DEFS = {
    right:  { label: '→ 進む',  dir: 1,  kind: 'move' },
    left:   { label: '← 引く',  dir: -1, kind: 'move' },
    jump:   { label: 'ジャンプ', dir: 1,  kind: 'jump' },
    crouch: { label: 'しゃがむ', dir: 0,  kind: 'wait', crouch: true },
    wait:   { label: '待つ',    dir: 0,  kind: 'wait', crouch: false }
  };

  function fixedAmountOf(type) {
    var def = BLOCK_DEFS[type] || BLOCK_DEFS.wait;
    if (def.kind === 'move') return MOVE_CELLS;
    if (def.kind === 'wait') return FIXED_BEATS[type] || 1;
    return 1; // jump
  }
  function unitOf(type) {
    var k = BLOCK_DEFS[type] ? BLOCK_DEFS[type].kind : 'move';
    return (k === 'wait') ? '拍' : (k === 'jump') ? '' : 'マス';
  }

  // =====================================================================
  // ★ 多局面対応 simulatePlan — 1本の計画を前進シミュレートして tape を作る（決定論の心臓部）
  //   cmd_548 との差: フレームごとに「今の局面が満たされたか」を判定し、満たされたら次局面へ。
  //   step() の物理は不変。局面進行は state を見て applyBeat で切り替えるだけ（決定論）。
  // =====================================================================
  function simulatePlan(plan) {
    var stage = currentStage();
    var st = initialState();
    st.playerX = cellToX(xToCell(st.playerX));

    var beatIdx = 0;
    applyBeat(st, stage, 0);
    // initialState は GHOST_START を見ているので、beat0 のお化け位置で上書き済み（applyBeat 内）

    var tape = [snapshot(st, -1, beatIdx)];
    var blocks = [];
    var softFails = 0;
    var winTime = -1;
    var stageWon = false;

    // フレーム後処理: ソフト失敗集計＋局面進行判定＋tape へ snapshot。stageWon を返す。
    function afterFrame(blockIndex) {
      softFails += countClosed(st);
      if (!stageWon) {
        var cur = stage.beats[beatIdx];
        if (cur.kind === 'ghost') {
          if (st.result === 'win') {
            if (cur.final) { stageWon = true; if (winTime < 0) winTime = st.t; }
            else { beatIdx++; applyBeat(st, stage, beatIdx); }   // 中間局面クリア→次へ（社交リセット）
          }
        } else { // travel
          if (st.grounded && xToCell(st.playerX) >= cur.goalCell) {
            if (cur.final) { stageWon = true; if (winTime < 0) winTime = st.t; }
            else { beatIdx++; applyBeat(st, stage, beatIdx); }
          }
        }
      }
      tape.push(snapshot(st, blockIndex, beatIdx));
      return stageWon;
    }

    for (var bi = 0; bi < plan.blocks.length; bi++) {
      var blk = plan.blocks[bi];
      var def = BLOCK_DEFS[blk.type] || BLOCK_DEFS.wait;
      var amount = fixedAmountOf(blk.type);
      var startCell = xToCell(st.playerX);
      var startX = st.playerX;
      var blocked = false;

      if (def.kind === 'move') {
        var targetCell = clamp(startCell + def.dir * MOVE_CELLS, 0, MAXCELL);
        var targetX = cellToX(targetCell);
        var best = def.dir * st.playerX;
        var noProg = 0;
        for (var f = 0; f < SAFE_FRAMES_MOVE; f++) {
          step(st, { dir: def.dir, crouch: false, jump: false }, DT);
          if (afterFrame(bi)) break;
          if ((def.dir > 0 && st.playerX >= targetX - 1e-6) ||
              (def.dir < 0 && st.playerX <= targetX + 1e-6)) { break; }
          var prog = def.dir * st.playerX;
          if (prog > best + STUCK_EPS) { best = prog; noProg = 0; } else { noProg++; }
          if (noProg >= STUCK_LIMIT) { blocked = true; break; }
        }
        snapToGrid(st);
      } else if (def.kind === 'jump') {
        var launched = false, airborneSeen = false;
        for (var fj = 0; fj < SAFE_FRAMES_JUMP; fj++) {
          step(st, { dir: 1, crouch: false, jump: !launched }, DT);
          launched = true;
          if (afterFrame(bi)) break;
          if (!st.grounded) airborneSeen = true;
          if (airborneSeen && st.grounded) break;
        }
        snapToGrid(st);
      } else { // wait / crouch（拍）
        var frames = Math.max(1, amount) * BEAT_FRAMES;
        for (var fw = 0; fw < frames; fw++) {
          step(st, { dir: 0, crouch: !!def.crouch, jump: false }, DT);
          if (afterFrame(bi)) break;
        }
      }

      var endCell = xToCell(st.playerX);
      blocks.push({
        type: blk.type, amount: amount,
        startCell: startCell, endCell: endCell,
        startX: startX, endX: st.playerX,
        reachCells: endCell - startCell,
        blocked: blocked
      });
      if (stageWon) break;
    }

    var outcome = {
      result: stageWon ? 'win' : 'incomplete',
      time: (winTime >= 0) ? winTime : st.t,
      softFails: softFails,
      beatsCleared: stageWon ? stage.beats.length : beatIdx,
      beatsTotal: stage.beats.length
    };
    var endT = tape.length ? tape[tape.length - 1].t : 0;
    return { tape: tape, blocks: blocks, dt: DT, totalT: endT, frames: tape.length, outcome: outcome,
             beatsTotal: stage.beats.length };
  }

  function countClosed(st) {
    var c = 0;
    for (var e = 0; e < st.events.length; e++) if (st.events[e] === 'closed') c++;
    return c;
  }

  function snapToGrid(st) {
    if (!st.grounded) return;
    var x = cellToX(xToCell(st.playerX));
    if (x > GAP_L && x < GAP_R) {
      if (st.playerX <= (GAP_L + GAP_R) / 2) x = cellToX(Math.floor((GAP_L - X_MIN) / GRID));
      else x = cellToX(Math.ceil((GAP_R - X_MIN) / GRID));
    }
    st.playerX = x;
    st.playerVel = 0;
  }

  // snapshot: ★ 局面対応のため beatIndex / gapL / gapR を追加（描画が局面ごとの穴を per-frame で出せる）
  function snapshot(st, blockIndex, beatIndex) {
    return {
      t: st.t,
      playerX: st.playerX, y: st.y, grounded: st.grounded, crouching: st.crouching,
      ghostX: st.ghostX,
      phase: st.phase,
      dist: Math.abs(st.ghostX - st.playerX),
      guardR: guardRadiusOf(st.trust),
      closed: st.closedTimer > 0,
      result: st.result,
      blockIndex: blockIndex,
      beatIndex: beatIndex,
      gapL: GAP_L, gapR: GAP_R,
      _wariness: st.wariness, _trust: st.trust
    };
  }

  // ===== 今のステージのお手本／ダメ計画 =====
  //   examplePlan: ステージ定義の example（カード種別）を {type} 列へ。test_sim.js が final win を確認。
  function examplePlan() {
    return { blocks: currentStage().example.map(function (t) { return { type: t }; }) };
  }
  // 立って一気に詰め寄り続けるダメ計画（ソフト失敗の確認用）。各局面の穴に応じてジャンプを挟む。
  function naivePlan() {
    var blocks = [];
    var s = currentStage();
    // 全局面の穴をざっくり越えながら、立ったまま右へ押し込み続ける（しゃがまない＝信頼が育たない）
    var gapCells = s.beats.filter(function (b) { return b.gap; }).map(function (b) { return b.gap.cell; });
    var gi = 0;
    for (var i = 0; i < MAXCELL; i++) {
      if (gi < gapCells.length && i === gapCells[gi] - 1) { blocks.push({ type: 'jump' }); gi++; }
      blocks.push({ type: 'right' });
    }
    return { blocks: blocks };
  }

  var API = {
    DT: DT,
    GROUND_Y: GROUND_Y,
    GRID: GRID, BEAT_FRAMES: BEAT_FRAMES,
    MOVE_CELLS: MOVE_CELLS, FIXED_BEATS: FIXED_BEATS,
    PLAYER_SPEED: PLAYER_SPEED, GHOST_SPEED: GHOST_SPEED, JUMP_V: JUMP_V, GRAVITY: GRAVITY,
    COMFORT_NEAR: COMFORT_NEAR, WARY_MAX: WARY_MAX, VIEW: VIEW,
    BLOCK_DEFS: BLOCK_DEFS, fixedAmountOf: fixedAmountOf, unitOf: unitOf,
    clamp: clamp, lerp: lerp,
    cellToX: cellToX, xToCell: xToCell,
    initialState: initialState, step: step,
    targetDistOf: targetDistOf, guardRadiusOf: guardRadiusOf, derivePhase: derivePhase,
    simulatePlan: simulatePlan,
    examplePlan: examplePlan, naivePlan: naivePlan,
    // ★ cmd_548 ステージAPI
    stageList: stageList, loadStage: loadStage, currentStage: currentStage,
    // ★ cmd_549 多局面/ストーリーAPI
    stageIntro: stageIntro, beatMeta: beatMeta,
    // ステージ依存の現在値（読み取り用ゲッタ。定数ではなく今のステージ/局面の値を返す）
    get X_MIN() { return X_MIN; },
    get X_MAX() { return X_MAX; },
    get MAXCELL() { return MAXCELL; },
    get PLAYER_START() { return PLAYER_START; },
    get GHOST_START() { return GHOST_START; },
    get GAP_L() { return GAP_L; },
    get GAP_R() { return GAP_R; },
    get COMFORT_FAR() { return COMFORT_FAR; },
    get SPACE_MARGIN() { return SPACE_MARGIN; },
    get ADJACENT() { return ADJACENT; },
    get TRUST_WIN() { return TRUST_WIN; },
    get WIN_WARY_GATE() { return WIN_WARY_GATE; },
    get currentStageIndex() { return currentStageIndex; }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;       // node（テスト）用
  } else {
    root.SIM = API;             // ブラウザ用（window.SIM）
  }
})(typeof window !== 'undefined' ? window : this);
