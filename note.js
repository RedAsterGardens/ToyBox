/* =====================================================================
 * note.js — cmd_553「フカシギ式ヒント機構」エンジン（決定論・DOM非依存・node から require 可）
 *
 * ◆ これは何か（本命PoCの主役）
 *   『ヨッシーとフカシギの図鑑』の「目的を推理して発見する」体験を、恋ハロ／ハロウィンジャーに移植する層。
 *   フカシギの弱点＝「目的を完全に隠す→総当たりになりがち／ヒントは能動的に聞かないと来ない」。
 *   本作はそれを次の3点で“推理”に変える：
 *     (1) ゴールを **ふんわり** 隠す（クリア条件は明示しない。ただしストーリー会話が「解釈の方向＝入口」を能動提示）。
 *     (2) **ヒーローノート**（2段階）：試行（観察）のたび『行動がお化けに与えた影響』を**自動記録**。
 *         ①事実（正解直書きせず「うれしそう/いやがってる」等）→ ②既定3つ貯まると**仮説**を解放（断定しない「〇〇かも？」）。
 *     (3) **救済**：総当たりで全パターン試せば事実が貯まり仮説が出て必ず解ける（詰み防止）。
 *         一方、ストーリー入口＋ノートを突き合わせれば総当たり前に**推理で早解き**もできる。
 *
 * ◆ なぜ独立ファイルか（コアを壊さず層を足す＝cmd_552 の流儀の徹底）
 *   sim.js（判定/物理コア）は cmd_552 と **バイト完全同一**（diff で確認）。フカシギ層は sim.js を一切触らず
 *   この note.js に閉じ込めた。＝「決定論コアは無改変のまま、ヒント機構というレイヤーだけを足す」。
 *   将来 ターン制(cmd_550)/ギミック(cmd_551) を載せるときも、観測 → 事実 → 仮説 の同じ枠にデータを足すだけで拡張できる
 *   （design_log の「将来接続点」参照）。
 *
 * ◆ 決定論
 *   事実の導出は SIM.simulatePlan(plan) が返す tape（snapshot 列）だけを読む純関数。
 *   同じ計画 → 同じ tape → 同じ事実。Math.random / Date を一切使わない。
 *
 * ◆ ヒント量は「定数/データ」で手触り調整できる（acceptance_criteria 6）
 *   - HYPOTHESIS_THRESHOLD … 仮説解放に必要な事実数（既定3）。上げれば「もっと試さないと仮説が出ない」。
 *   - NEAR_DIST / FAR_DIST … 「近い/遠い」の境（記録の粒度）。
 *   - PERSONA[*].facts / hypothesis / entry … 表現の踏み込み具合（語彙だけ差し替えれば踏み込み量を調整）。
 * ===================================================================== */

(function (root) {
  'use strict';

  // ===== ヒント量チューニング定数（ここを変えるだけで手触りが変わる）=====
  var HYPOTHESIS_THRESHOLD = 3;   // 事実がこの数だけ貯まると仮説が解放（＝何個も試したご褒美）
  var NEAR_DIST = 16;             // この距離以下でしゃがむ＝「近くで」
  var FAR_DIST  = 24;             // この距離以上でしゃがむ＝「はなれて」

  // ===== お化けの性格（ペルソナ）=====
  //   ゴールを「ふんわり」隠すための“入口”＋推理を支える“事実の語彙”＋一歩踏み込む“仮説”を持つ。
  //   ★ いずれも **正解を直書きしない**：事実は「どう見えたか（うれしそう/いやがってる）」、仮説は「〇〇かも？」止まり。
  //   ★ persona ごとに crouchedFar/crouchedNear の手応えが **逆** ＝ ここが推理の肝（遠がいい子か/近くがいい子か）。
  var PERSONA = {
    // 臆病：近づかれるのが怖い＝はなれてしゃがむと安心（遠が正）
    timid: {
      label: 'おくびょう',
      entry: 'この子は おくびょうで、近づかれるのが こわいみたい。',
      facts: {
        rushed:      '立ったまま 近づくと、こわがって 後ずさった。',
        closed:      'ぐいぐい 行きすぎて、心を とじてしまった。',
        crouchedFar: 'すこし はなれて しゃがむと、警戒を ゆるめて くれた。',
        crouchedNear:'ぐっと 近くで しゃがむと、はじめは ドキドキ していた。',
        won:         'あせらず 間合いを とって 待ったら、そっと 隣に いさせて くれた。'
      },
      hypothesis: '🔎 仮説：この子は 近づかれるのが こわいのかも？ ' +
                  'むりに 詰めず、すこし はなれて しゃがんで 待つと、心を ひらいて くれるのかも…？'
    },
    // さみしがり：ひとりが寂しい＝そばでしゃがんで寄り添うと喜ぶ（近が正）
    lonely: {
      label: 'さみしがり',
      entry: 'この子は ずっと ひとりぼっち。だれかに そばに いて ほしいみたい。',
      facts: {
        rushed:      '立ったまま 近づくと、びくっと 身を ひいた。',
        closed:      'きゅうに ぐいっと 行ったら、おどろいて 心を とじた。',
        crouchedFar: 'はなれた ままだと、さみしそうに うつむいて いた。',
        crouchedNear:'すぐ そばで しゃがむと、うれしそうに 顔を あげた。',
        won:         'となりで よりそって 待ったら、はじめて わらって くれた。'
      },
      hypothesis: '🔎 仮説：この子は ずっと ひとりで さみしいのかも？ ' +
                  'にげずに そばまで 行って、となりで しゃがんで よりそうと いいのかも…？'
    },
    // おだやか（出会い・道中の子）：見下ろされるのが苦手＝しゃがめば落ち着く（基礎の逆説を学ぶ）
    gentle: {
      label: 'おだやか',
      entry: 'この子は、上から こられると ちょっと こわいみたい。',
      facts: {
        rushed:      '立ったまま 近づくと、ちょっと 身がまえた。',
        closed:      '詰め寄りすぎて、すこし 心を とじた。',
        crouchedFar: 'しゃがんで 待つと、だんだん 落ち着いて きた。',
        crouchedNear:'近くで しゃがんで 待つと、安心した みたい。',
        won:         'そっと しゃがんで 待ったら、隣に きて くれた。'
      },
      hypothesis: '🔎 仮説：この子は 見下ろされるのが 苦手なのかも？ ' +
                  'しゃがんで そっと 待つと、安心して くれるのかも…？'
    }
  };

  // お化け名 → ペルソナ（sim.js の beatMeta が返す b.name で引く。未知は gentle）。
  // ＝sim.js を触らず（名前は既存データ）にペルソナを与えるブリッジ。
  var PERSONA_BY_GHOST = {
    '庭のおばけ':   'gentle',
    '裂け目のおばけ':'gentle',
    '夜道のおばけ': 'gentle',
    '臆病なおばけ': 'timid',
    'すねん坊':     'timid',
    'さみしがり':   'lonely'
  };

  // ゴールを「ふんわり」隠す共通文言（“何をすれば良いか”は言わない＝推理で発見させる）。
  var GOAL_HINT = '❓ この子の 心を ひらく『方法』は、まだ わからない。' +
                  '動いて 観察し、ノートの 発見から 推理しよう。';

  function personaKeyOf(ghostName) {
    return PERSONA_BY_GHOST[ghostName] || 'gentle';
  }
  function personaOf(ghostName) { return PERSONA[personaKeyOf(ghostName)]; }
  function entryOf(ghostName)   { return personaOf(ghostName).entry; }
  function hypothesisTextOf(ghostName) { return personaOf(ghostName).hypothesis; }
  function goalHint() { return GOAL_HINT; }

  // 事実の表示順（安定）。各 id は PERSONA[*].facts のキー。
  var FACT_ORDER = ['rushed', 'closed', 'crouchedFar', 'crouchedNear', 'won'];

  // =====================================================================
  // deriveBeatFacts — ある ghost 局面の frames（tape）から「観察された事実」を導出（決定論・純関数）
  //   入力: simResult（SIM.simulatePlan の戻り）, beatIndex, beatMetaArr（SIM.beatMeta(idx)）
  //   出力: { ghost, persona, facts:[{id,text}], won, closed } または null（ghost 局面でない/未到達）
  //   ★ snapshot のフィールド（crouching/dist/guardR/phase/closed/result/_trust）だけを見る＝物理を再計算しない。
  // =====================================================================
  function deriveBeatFacts(simResult, beatIndex, beatMetaArr) {
    var meta = beatMetaArr[beatIndex];
    if (!meta || meta.kind !== 'ghost') return null;
    var frames = simResult.tape.filter(function (sn) { return sn.beatIndex === beatIndex; });
    if (frames.length === 0) return null;     // その局面にまだ到達していない＝観察ゼロ

    var pKey = personaKeyOf(meta.name);
    var p = PERSONA[pKey];

    var sig = { rushed: false, closed: false, crouchedFar: false, crouchedNear: false, won: false };
    for (var i = 0; i < frames.length; i++) {
      var sn = frames[i];
      var inside = sn.dist < sn.guardR;                       // 警戒圏の内側
      if (sn.closed) sig.closed = true;
      if (sn.result === 'win') sig.won = true;
      if (!sn.crouching) {
        // 立って警戒圏に入って こわがらせた（詰め寄り）
        if (inside && (sn.phase === 'wary' || sn.phase === 'scared')) sig.rushed = true;
      } else {
        // しゃがんだ距離を「遠い/近い」に量子化（記録の粒度＝NEAR/FAR 定数）
        if (sn.dist >= FAR_DIST)  sig.crouchedFar = true;
        else if (sn.dist <= NEAR_DIST) sig.crouchedNear = true;
      }
    }

    var facts = [];
    FACT_ORDER.forEach(function (id) {
      if (sig[id]) facts.push({ id: id, text: p.facts[id] });
    });
    return { ghost: meta.name, persona: pKey, facts: facts, won: sig.won, closed: sig.closed };
  }

  // =====================================================================
  // createNote — ヒーローノート（試行をまたいで事実を蓄積し、3つで仮説を解放）
  //   game.js が1つ持ち、▶再生が末尾まで進むたび observe() を呼ぶ。お化けごとに別ノート。
  //   ロジックを note.js 側に置くことで test_sim.js から「3つで仮説解放」を機械担保できる。
  // =====================================================================
  function createNote(threshold) {
    var TH = (threshold == null) ? HYPOTHESIS_THRESHOLD : threshold;
    var byGhost = {};   // ghostName -> { persona, factIds:[], facts:[{id,text}], won:bool }

    function bucket(ghost, persona) {
      if (!byGhost[ghost]) byGhost[ghost] = { persona: persona, factIds: [], facts: [], won: false };
      return byGhost[ghost];
    }

    return {
      threshold: TH,
      // 1回の試行（再生し終えた計画の tape）から、登場した全 ghost 局面の事実を取り込む。
      observe: function (simResult, beatMetaArr) {
        var added = 0;
        for (var bi = 0; bi < beatMetaArr.length; bi++) {
          if (beatMetaArr[bi].kind !== 'ghost') continue;
          var d = deriveBeatFacts(simResult, bi, beatMetaArr);
          if (!d) continue;
          var g = bucket(d.ghost, d.persona);
          if (d.won) g.won = true;
          d.facts.forEach(function (f) {
            if (g.factIds.indexOf(f.id) < 0) { g.factIds.push(f.id); g.facts.push(f); added++; }
          });
        }
        return added;
      },
      ghosts: function () { return Object.keys(byGhost); },
      has: function (ghost) { return !!byGhost[ghost]; },
      factsOf: function (ghost) { return byGhost[ghost] ? byGhost[ghost].facts.slice() : []; },
      countOf: function (ghost) { return byGhost[ghost] ? byGhost[ghost].facts.length : 0; },
      wonOf: function (ghost) { return !!(byGhost[ghost] && byGhost[ghost].won); },
      // 仮説：事実が閾値に達したら解放（断定しない「〇〇かも？」）。未達は null（進捗は countOf で出す）。
      hypothesisOf: function (ghost) {
        var g = byGhost[ghost];
        if (!g || g.facts.length < TH) return null;
        return PERSONA[g.persona].hypothesis;
      },
      // 進捗（あと何個で仮説か）。数値ゲージ（気持ち）ではなく“発見の進み”を示すための軽い指標。
      progressOf: function (ghost) {
        var have = byGhost[ghost] ? byGhost[ghost].facts.length : 0;
        return { have: have, need: TH, unlocked: have >= TH };
      },
      reset: function () { byGhost = {}; }
    };
  }

  var API = {
    HYPOTHESIS_THRESHOLD: HYPOTHESIS_THRESHOLD,
    NEAR_DIST: NEAR_DIST, FAR_DIST: FAR_DIST,
    FACT_ORDER: FACT_ORDER,
    PERSONA: PERSONA, PERSONA_BY_GHOST: PERSONA_BY_GHOST,
    personaKeyOf: personaKeyOf, personaOf: personaOf,
    entryOf: entryOf, hypothesisTextOf: hypothesisTextOf, goalHint: goalHint,
    deriveBeatFacts: deriveBeatFacts,
    createNote: createNote
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;       // node（テスト）用
  } else {
    root.NOTE = API;            // ブラウザ用（window.NOTE）
  }
})(typeof window !== 'undefined' ? window : this);
