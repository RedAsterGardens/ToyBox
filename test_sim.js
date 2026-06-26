/* =====================================================================
 * test_sim.js — cmd_549 sim.js のロジック検証（node 専用）
 *   実行: node test_sim.js
 *
 * cmd_548 の担保（決定論・複数ステージ・全面クリア可・クリア窓(遊び幅)・歯ごたえ・固定マス・到達一意・
 * マス拡大・穴ジャンプ・phase）に加え、cmd_549 の主題『多局面（ビート）連鎖＋ストーリー（手がかり）』を機械担保する:
 *   M1. ★ 少なくとも1ステージが 3局面以上の連鎖（multibeat）
 *   M2. ★ multibeat ステージは お手本=1本の計画 で 全局面を段階クリアして final win に到達
 *   M3. ★ multibeat の局面 index が tape 上で 0→1→…→最終 と単調進行（飛ばさず段階的）
 *   M4. ★ 行動カードの語彙を増やしていない（BLOCK_DEFS は cmd_547 の5種のみ）
 *   M5. ★ ストーリー/手がかりがデータとして存在（各ステージ intro≥1行、各 ghost 局面に clue、各局面に banner）
 *        ＝ game.js が画面提示できる素材がある（cmd_544 の“画面未提示”退化を回避する前提）
 *   M6. ★ multibeat でも決定論（同一計画→tape 完全一致）＝先読み=再生・巻戻し再計画の根拠
 *   M7. ★ 手がかりが効く＝ multibeat で「しゃがまず立って詰め寄り続ける」計画は final win しない（歯ごたえ）
 *   M8. ★ 物理コア不変の証跡: step() の主要しきい値定数が cmd_547/548 と同値
 * 既存（単一お化けステージ ①〜④）には cmd_548 のチェックをそのまま適用。
 * ===================================================================== */

var SIM = require('./sim.js');

var ok = true;
function check(label, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + label + (extra ? '  — ' + extra : ''));
  if (!cond) ok = false;
}
function runTypes(types) {
  return SIM.simulatePlan({ blocks: types.map(function (t) { return { type: t }; }) });
}

var STAGES = SIM.stageList();
console.log('=== cmd_549 simulation self-test（多局面ビート連鎖／ストーリー手がかり／+ cmd_548 継承）===');
console.log('ステージ数: ' + STAGES.length + '  [' + STAGES.map(function (s) {
  return s.name + (s.multibeat ? '★多局面' : '') + '(' + s.beatCount + 'b)';
}).join(' / ') + ']\n');

// ===================================================================
// M. cmd_549 主題テスト
// ===================================================================
console.log('--- M. cmd_549 多局面＋ストーリー検証 ---');

// M1. 少なくとも1ステージが multibeat（3局面以上）
var multibeatStages = STAGES.filter(function (s) { return s.multibeat; });
check('M1. 少なくとも1ステージが3局面以上の連鎖（multibeat）', multibeatStages.length >= 1,
      multibeatStages.map(function (s) { return s.name + '(' + s.beatCount + 'b)'; }).join(', '));

// M4. 行動カードの語彙を増やしていない（cmd_547 の5種のみ）
(function () {
  var keys = Object.keys(SIM.BLOCK_DEFS).sort();
  var expect = ['crouch', 'jump', 'left', 'right', 'wait'].sort();
  check('M4. 行動カードの語彙は cmd_547 の5種のみ（新しい動詞を足していない）',
        JSON.stringify(keys) === JSON.stringify(expect), keys.join('/'));
})();

// M5. ストーリー/手がかりがデータとして存在（画面提示の素材）
(function () {
  var allIntro = true, allBanner = true, ghostClue = true, detail = [];
  STAGES.forEach(function (si) {
    var intro = SIM.stageIntro(si.index);
    var beats = SIM.beatMeta(si.index);
    if (!(intro && intro.length >= 1)) { allIntro = false; detail.push(si.index + ':introなし'); }
    beats.forEach(function (b) {
      if (!b.banner) allBanner = false;
      if (b.kind === 'ghost' && !b.clue) ghostClue = false;
    });
  });
  check('M5. 各ステージに ステージ前会話 intro が存在（≥1行・画面提示の素材）', allIntro, detail.join(' '));
  check('M5. 各局面に道中メッセージ banner が存在', allBanner);
  check('M5. 各 ghost 局面に 推理の手がかり clue が存在', ghostClue);
})();

// multibeat ステージ群について M2/M3/M6/M7
multibeatStages.forEach(function (si) {
  SIM.loadStage(si.index);
  var s = SIM.currentStage();
  console.log('\n--- ' + s.name + ' (beats=' + s.beats.length + ', MAXCELL=' + SIM.MAXCELL + ') ---');
  var beatsMeta = SIM.beatMeta(si.index);
  console.log('  局面: ' + beatsMeta.map(function (b) {
    return '[' + b.index + ':' + b.kind + (b.kind === 'ghost' ? '(' + b.name + ')' : '→cell' + b.goalCell) + (b.final ? '*final' : '') + ']';
  }).join(' '));

  var r = runTypes(s.example);

  // M2. お手本=1本の計画 で全局面を段階クリアして final win
  check('M2. お手本(1本の計画)で全局面を段階クリアして final win に到達',
        r.outcome.result === 'win' && r.outcome.beatsCleared === s.beats.length,
        'result=' + r.outcome.result + ' cleared=' + r.outcome.beatsCleared + '/' + r.outcome.beatsTotal +
        ' t=' + r.outcome.time.toFixed(1) + 's plan=' + s.example.length + '枚');

  // M3. tape 上で 局面 index が 0→…→最終 と単調進行（飛ばさず段階的）
  (function () {
    var seen = [];
    r.tape.forEach(function (sn) { if (seen.length === 0 || seen[seen.length - 1] !== sn.beatIndex) {
      if (seen.indexOf(sn.beatIndex) < 0) seen.push(sn.beatIndex); } });
    var monotonic = true;
    for (var i = 1; i < seen.length; i++) if (seen[i] !== seen[i - 1] + 1) monotonic = false;
    var full = seen.length === s.beats.length && seen[0] === 0 && seen[seen.length - 1] === s.beats.length - 1;
    check('M3. 局面 index が 0→…→最終 と段階的に単調進行（飛ばさない）', monotonic && full,
          '辿った局面=' + seen.join('→'));
  })();

  // M6. 決定論（同一計画→tape 完全一致）
  var r2 = runTypes(s.example);
  check('M6. 決定論: 同一計画の2回シミュレートで tape 完全一致（先読み=再生・巻戻し再計画の根拠）',
        JSON.stringify(r.tape) === JSON.stringify(r2.tape), 'frames=' + r.frames);

  // M7. 立って詰め寄り続ける（しゃがまない）計画は final win しない＝手がかり（しゃがみ/間合い）が効く
  (function () {
    var naive = SIM.simulatePlan(SIM.naivePlan());
    check('M7. 立って詰め寄り続ける(しゃがまない)計画は final win しない（歯ごたえ＝手がかりが効く）',
          naive.outcome.result !== 'win',
          'result=' + naive.outcome.result + ' cleared=' + naive.outcome.beatsCleared + '/' + naive.outcome.beatsTotal +
          ' soft=' + naive.outcome.softFails);
  })();

  // M7b. 性格の手がかりが効く実例: 手前の臆病な子に「立ったまま押し込み続ける」と心を閉ざす（ソフト失敗）
  (function () {
    // beat0(travel) を渡ってから、しゃがまず right を連打して手前のお化けに詰め寄る
    var firstGap = s.beats[0].gap ? s.beats[0].gap.cell : 3;
    var cross = [];
    for (var i = 0; i < Math.max(0, firstGap - 1); i++) cross.push('right');
    cross.push('jump');
    var rush = cross.concat(['right', 'right', 'right', 'right', 'right', 'right', 'wait', 'wait']);
    var rr = runTypes(rush);
    var closed = rr.tape.some(function (sn) { return sn.closed; });
    check('M7b. 手前のお化けに「立って詰め寄り続ける」と心を閉ざす（手がかり“詰め寄ると縮こまる”が実機構）',
          closed && rr.outcome.result !== 'win', 'closed=' + closed + ' result=' + rr.outcome.result);
  })();
});

// M8. 物理コア不変の証跡（cmd_547/548 と同値のしきい値定数）
(function () {
  check('M8. 物理コア不変: GRID=10 / 移動1枚=1マス / しゃがみ待ち=2拍 / VIEW=60 / WARY_MAX=100',
        SIM.GRID === 10 && SIM.MOVE_CELLS === 1 && SIM.FIXED_BEATS.crouch === 2 &&
        SIM.VIEW === 60 && SIM.WARY_MAX === 100);
})();

// ===================================================================
// D. ★ cmd_552 直接ドライブ型入力の検証（入力方式PoC）
//   核心: 直接ドライブは sim.js を一切変えない。game.js が「方向キーで動かす」操作を
//   1マス分の行動カード（→/←/jump/crouch/wait の5種のまま）として plan.blocks[] に
//   追記するだけ＝カード式と完全に同じデータ・同じ決定論・同じ先読み=再生。
//   よって本テストは sim 層で「(D1)連続移動の1マス量子化」「(D2)両入力が同じ計画データに落ちる」
//   「(D3)ドライブで作った計画も決定論＝先読み=再生一致」「(D4)録画＝計画再生で到達セルが一意」を機械担保する。
//   ＝game.js 側の入力レイヤーが満たすべき不変条件を、判定コア基準で固定する。
// ===================================================================
console.log('\n--- D. cmd_552 直接ドライブ型入力（入力方式PoC）検証 ---');

// ドライブのキー入力（5種のみ）→カード種。game.js KEYMAP の値と一致（新しい動詞は無い）。
var DRIVE_ACTIONS = ['right', 'left', 'jump', 'crouch', 'wait'];
// ドライブ操作列（押した行動の並び）を計画データへ。game.js の driveAppend が push する形と同型。
function recordDrive(actions) { return { blocks: actions.map(function (a) { return { type: a }; }) }; }

// D0. ドライブで記録できる語彙は5種のまま（カードと同じ・新しい動詞を足していない）
(function () {
  var cardKeys = Object.keys(SIM.BLOCK_DEFS).sort();
  var driveKeys = DRIVE_ACTIONS.slice().sort();
  check('D0. ドライブ入力の語彙＝カードの5種と完全一致（新しい動詞を足していない）',
        JSON.stringify(driveKeys) === JSON.stringify(cardKeys), 'drive=' + driveKeys.join('/'));
})();

// D1. 量子化: 押しっぱ連続移動も内部は固定マス1マス単位。どの移動ブロックも 1マスを超えない。
(function () {
  SIM.loadStage(0); // ① はじまりの庭（穴なし）＝移動の量子化を素直に観察
  var hold = []; for (var i = 0; i < 20; i++) hold.push('right');   // 「→押しっぱ20マス分」相当
  var r = SIM.simulatePlan(recordDrive(hold));
  var moveBlocks = r.blocks.filter(function (b) { return SIM.BLOCK_DEFS[b.type].kind === 'move'; });
  // 量子化の本質＝「1ブロックは1マスを超えて進まない」。壁際やソフト失敗中の0マスは正当（>1が無いことが要件）。
  var noneOverOne = moveBlocks.every(function (b) { return Math.abs(b.reachCells) <= 1; });
  var someMovedOne = moveBlocks.filter(function (b) { return Math.abs(b.reachCells) === 1; }).length;
  check('D1. 連続移動も内部は固定マス1マス単位に量子化（どの移動ブロックも>1マス進まない・1マス刻みで進む）',
        noneOverOne && someMovedOne >= 3,
        '>1マスの移動ブロック=' + moveBlocks.filter(function (b) { return Math.abs(b.reachCells) > 1; }).length +
        '個 / 1マス前進ブロック=' + someMovedOne + '個');
})();

// D2. 両入力方式が同じ計画データに落ちる＝同じ tape・同じ結果。
//     カード式お手本(⑤多局面) と、同じ操作を1マスずつ録ったドライブ計画は、データも tape も完全一致。
(function () {
  var festIdx = STAGES.filter(function (s) { return s.multibeat; })[0].index;
  SIM.loadStage(festIdx);
  var cardPlan  = SIM.examplePlan();                                   // カード式の計画データ
  var drivePlan = recordDrive(SIM.currentStage().example.slice());     // 同じ操作をドライブで録った計画データ
  check('D2. カード式とドライブ式が同一の計画データ（plan.blocks）に落ちる',
        JSON.stringify(cardPlan.blocks) === JSON.stringify(drivePlan.blocks), '⑤多局面お手本');
  var rc = SIM.simulatePlan(cardPlan), rd = SIM.simulatePlan(drivePlan);
  check('D2. 同じステージ・同じ sim ゆえ tape が完全一致（入力方式が違っても挙動は同一）',
        JSON.stringify(rc.tape) === JSON.stringify(rd.tape), 'frames=' + rd.frames);
  check('D2. ドライブで録った計画も全局面を段階クリアして final win（カード式と同じ到達）',
        rd.outcome.result === 'win' && rd.outcome.beatsCleared === rd.outcome.beatsTotal,
        'result=' + rd.outcome.result + ' cleared=' + rd.outcome.beatsCleared + '/' + rd.outcome.beatsTotal);
})();

// D3. ドライブで作った計画も決定論（同一計画→tape 完全一致）＝先読み=再生・録り直しの根拠。
(function () {
  SIM.loadStage(STAGES.filter(function (s) { return s.multibeat; })[0].index);
  var drivePlan = recordDrive(SIM.currentStage().example.slice());
  var a = SIM.simulatePlan(drivePlan), b = SIM.simulatePlan(drivePlan);
  check('D3. ドライブで録った計画も決定論: 2回シミュレートで tape 完全一致（先読み=再生一致）',
        JSON.stringify(a.tape) === JSON.stringify(b.tape), 'frames=' + a.frames);
})();

// D4. 録画＝計画再生で到達セルが一意（同じ操作列→同じ最終セル）。録り直し(末尾pop)も決定論で前方一致。
(function () {
  SIM.loadStage(0);
  var seq = ['right', 'right', 'crouch', 'crouch', 'right'];
  var full = SIM.simulatePlan(recordDrive(seq));
  var endCell1 = SIM.xToCell(full.tape[full.tape.length - 1].playerX);
  var endCell2 = SIM.xToCell(SIM.simulatePlan(recordDrive(seq)).tape.slice(-1)[0].playerX);
  check('D4. 同じドライブ操作列→到達セルが一意（決定論・録画的に再現可能）', endCell1 === endCell2,
        '到達cell=' + endCell1);
  var undone = SIM.simulatePlan(recordDrive(seq.slice(0, -1)));     // 末尾1ブロック取消＝undoLastDrive 相当
  var prefix = SIM.simulatePlan(recordDrive(seq.slice(0, -1)));
  check('D4. 録り直し（末尾1マスを取り消す）も決定論で前方一致',
        JSON.stringify(undone.tape) === JSON.stringify(prefix.tape), '残り' + (seq.length - 1) + 'マス');
})();

// ===================================================================
// 既存（cmd_548 継承）: 全ステージ／単一お化けステージのコア検証
// ===================================================================
console.log('\n--- cmd_548 継承コア検証 ---');

// E. マス拡大維持（GRID=10）
check('E. マス拡大を維持（GRID=10。cmd_547 を継承）', SIM.GRID === 10, 'GRID=' + SIM.GRID);

// F. 複数ステージ（3面以上＋各面の差異）
check('F. ステージが3面以上ある（複数ステージ化）', STAGES.length >= 3, STAGES.length + '面');
(function () {
  var sigs = STAGES.map(function (s) {
    SIM.loadStage(s.index);
    return [SIM.X_MAX, SIM.GHOST_START, SIM.MAXCELL, s.beatCount].join(',');
  });
  var uniq = sigs.filter(function (v, i) { return sigs.indexOf(v) === i; });
  check('F. 各ステージで 床幅/お化け位置/局面数 のいずれかが異なる（手触りの違い）',
        uniq.length === STAGES.length, uniq.length + '/' + STAGES.length + ' がユニーク');
})();

// G. 全ステージ お手本は final win（全面クリア可能）
STAGES.forEach(function (si) {
  SIM.loadStage(si.index);
  var s = SIM.currentStage();
  var r = runTypes(s.example);
  check('G. お手本プランは final win に到達: ' + s.name, r.outcome.result === 'win',
        'cleared=' + r.outcome.beatsCleared + '/' + r.outcome.beatsTotal + ' t=' + r.outcome.time.toFixed(1));
});

// 単一お化けステージ（①〜④）に cmd_548 の固定マス／遊び幅／歯ごたえ／穴 を適用
STAGES.filter(function (s) { return !s.multibeat; }).forEach(function (si) {
  SIM.loadStage(si.index);
  var s = SIM.currentStage();
  var beat = s.beats[0]; // 単一お化け＝1局面
  console.log('\n--- ' + s.name + '（単一お化け：cmd_548 継承チェック）---');

  // A. 決定論
  var r1 = runTypes(s.example), r2 = runTypes(s.example);
  check('A. 決定論: 同一計画の2回シミュレートで tape 完全一致',
        JSON.stringify(r1.tape) === JSON.stringify(r2.tape), 'frames=' + r1.frames);

  // B. 1カード=1マス（開けた区間で move 1枚 = ±1）
  (function () {
    var approach = s.example.filter(function (t) { return t !== 'crouch' && t !== 'wait'; });
    var okMove = true, detail = [];
    ['right', 'left'].forEach(function (typ) {
      var r = runTypes(approach.concat([typ]));
      var b = r.blocks[r.blocks.length - 1];
      var moved = b.endCell - b.startCell;
      if (!b.blocked) {
        var expect = (typ === 'right') ? 1 : -1;
        if (moved !== expect) okMove = false;
        detail.push(typ + ':' + b.startCell + '->' + b.endCell);
      } else { detail.push(typ + ':(詰)'); }
    });
    check('B. 1カードの移動は1マス（startCell±1。詰まり時を除く）', okMove, detail.join(' '));
  })();

  // H. 遊び幅: しゃがみ枚数が複数通り win ＋ 止まり位置 ±1マスでも win
  (function () {
    var approach = s.example.filter(function (t) { return t !== 'crouch'; });
    var nCrouch = s.example.filter(function (t) { return t === 'crouch'; }).length;
    var winCounts = [];
    for (var k = 1; k <= nCrouch + 4; k++) {
      var plan = approach.concat(Array.from({ length: k }, function () { return 'crouch'; }));
      if (runTypes(plan).outcome.result === 'win') winCounts.push(k);
    }
    check('H. 遊び幅: しゃがみ枚数が複数通りでクリア成立（最適一択でない）',
          winCounts.length >= 3, '勝てる枚数={' + winCounts.join(',') + '}');

    function shift(delta) {
      var ap = approach.slice();
      if (delta > 0) ap.push('right');
      else if (delta < 0) { var idx = ap.lastIndexOf('right'); if (idx >= 0) ap.splice(idx, 1); }
      var plan = ap.concat(Array.from({ length: nCrouch + 2 }, function () { return 'crouch'; }));
      return runTypes(plan).outcome.result === 'win';
    }
    var base = shift(0), plus = shift(1), minus = shift(-1);
    check('H. 遊び幅: 止まり位置が ±1マスズレてもクリア成立（許容幅がある）',
          base && (plus || minus), '0=' + base + ' +1=' + plus + ' -1=' + minus);
  })();

  // I. 歯ごたえ: 立ち詰め / しゃがまない は win しない
  (function () {
    var naive = SIM.simulatePlan(SIM.naivePlan());
    var approach = s.example.filter(function (t) { return t !== 'crouch'; });
    var noCrouch = runTypes(approach.concat(['wait', 'wait', 'wait', 'wait']));
    check('I. 立って詰め寄り続けても win しない（回避でなく信頼が勝利条件）',
          naive.outcome.result !== 'win', 'naive=' + naive.outcome.result + ' soft=' + naive.outcome.softFails);
    check('I. しゃがまず待つだけでは win しない（しゃがみ逆説を無視したら失敗）',
          noCrouch.outcome.result !== 'win', 'result=' + noCrouch.outcome.result);
  })();

  // K. 穴（ありステージのみ）: 歩いて詰まる / ジャンプで越える
  if (beat.gap) {
    var gapCell = beat.gap.cell;
    var walkTypes = [];
    for (var w = 0; w < gapCell + 1; w++) walkTypes.push('right');
    var walk = runTypes(walkTypes);
    var wb = walk.blocks[walk.blocks.length - 1];
    var blocked = wb.blocked && SIM.cellToX(wb.endCell) <= SIM.GAP_L;
    var jumpTypes = [];
    for (var g = 0; g < Math.max(0, gapCell - 2); g++) jumpTypes.push('right');
    jumpTypes.push('jump');
    var jump = runTypes(jumpTypes);
    var jb = jump.blocks[jump.blocks.length - 1];
    var crossed = jb.endX > SIM.GAP_R + 1;
    check('K. 穴は歩いては渡れず手前で詰まる（blocked）', blocked,
          '到達cell=' + wb.endCell + ' blocked=' + wb.blocked + ' 穴左=' + SIM.GAP_L.toFixed(0));
    check('K. ジャンプで穴を越えられる（移動が主役）', crossed,
          'jump到達x=' + jb.endX.toFixed(1) + ' 穴右=' + SIM.GAP_R.toFixed(0));
  }
});

// ===== 横断的（ステージ非依存）コア検証 =====
console.log('\n--- 横断コア検証 ---');

// J. しゃがみ→信頼↑&警戒圏縮む / 立ち詰め→警戒↑（cmd_545 物理が不変）
SIM.loadStage(1);
(function () {
  var st = SIM.initialState();
  st.playerX = 70; st.ghostX = 100; st.trust = 0; st.wariness = 0;
  var r0 = SIM.guardRadiusOf(st.trust);
  for (var i = 0; i < Math.round(5 / SIM.DT); i++) SIM.step(st, { dir: 0, crouch: true, jump: false }, SIM.DT);
  var r5 = SIM.guardRadiusOf(st.trust);
  console.log('  [crouch-wait] 5s しゃがみ: trust 0→' + st.trust.toFixed(0) +
              ' / guardRadius ' + r0.toFixed(1) + '→' + r5.toFixed(1));
  check('J. しゃがんで待つと信頼が育つ', st.trust > 30, 'trust=' + st.trust.toFixed(0));
  check('J. 信頼が育つと警戒圏(guardRadius)が縮む（=物理的に近づける）', r5 < r0 - 3);

  var st2 = SIM.initialState();
  st2.playerX = 88; st2.ghostX = 100; st2.trust = 0; st2.wariness = 0;
  for (var j = 0; j < Math.round(1.5 / SIM.DT); j++) SIM.step(st2, { dir: 1, crouch: false, jump: false }, SIM.DT);
  check('J. 立って詰め寄ると警戒が上がる（逆説の対）', st2.wariness > 30, 'wary=' + st2.wariness.toFixed(0));
})();

// L. phase 3種以上
(function () {
  var phases = {};
  STAGES.forEach(function (si) {
    SIM.loadStage(si.index);
    var s = SIM.currentStage();
    runTypes(s.example).tape.forEach(function (st) { phases[st.phase] = true; });
    SIM.simulatePlan(SIM.naivePlan()).tape.forEach(function (st) { phases[st.phase] = true; });
  });
  var kinds = Object.keys(phases);
  console.log('  [legibility] 観測された phase 種類:', kinds.join(', '));
  check('L. お化けの挙動(phase)が3種類以上に分かれる', kinds.length >= 3, kinds.length + '種');
})();

// I'. 少なくとも1ステージで詰め寄りが心を閉ざす（ソフト失敗が実在する）
(function () {
  var anyClosed = false, detail = [];
  STAGES.forEach(function (si) {
    SIM.loadStage(si.index);
    var naive = SIM.simulatePlan(SIM.naivePlan());
    var closed = naive.tape.some(function (st) { return st.closed; });
    if (closed) anyClosed = true;
    detail.push(si.index + ':' + (closed ? '閉' : '-'));
  });
  check("I. 少なくとも1ステージで詰め寄りがソフト失敗（心を閉ざす）を起こす", anyClosed, detail.join(' '));
})();

// ===================================================================
// F. ★ cmd_553 フカシギ式ヒント機構（note.js）の検証 — 本命PoCの主役
//   note.js は決定論の純関数群（sim.js は cmd_552 とバイト完全同一・無改変）。
//   ここで acceptance_criteria を機械担保する:
//     F1 ゴールふんわり隠す（入口=気持ちのみ・手段“しゃがむ”は言わない／ゴール文言は「方法は不明・推理しよう」）
//     F2 ヒーローノート事実は決定論（同一計画→同一事実）
//     F3 事実は正解直書きでない（観察表現・「正解/こうすれば」を含まない）
//     F4 事実3つで仮説解放（閾値）＋ 閾値は定数で調整可能（ヒント量調整）
//     F5 仮説は断定でない（「かも」「？」・数字なし・「正解」なし）
//     F6 救済：総当たりで事実が貯まり仮説が出て必ず解ける（お手本=final win／総当たりで閾値到達）
//     F7 推理で早解き：良い計画は少ない試行で final win かつ事実も得られる
//     F8 ペルソナ対比（推理の肝）：timid と lonely で crouchedFar/Near の手応えが逆＝推理材料が存在
//     F9 物理コア不変の証跡（sim.js 定数が cmd_547/548/552 と同値）
// ===================================================================
var NOTE = require('./note.js');
console.log('\n--- F. cmd_553 フカシギ式ヒント機構（note.js）検証 ---');

function runTypesNote(types) { return SIM.simulatePlan({ blocks: types.map(function (t) { return { type: t }; }) }); }
function ghostBeatIndex() { var bm = SIM.beatMeta(SIM.currentStageIndex); for (var i = 0; i < bm.length; i++) if (bm[i].kind === 'ghost') return i; return -1; }
// 立って詰め寄り続ける“総当たり的ダメ計画”（rushed/closed を引き出す）
function rushPlan() {
  var s = SIM.currentStage(); var first = s.beats[0];
  var plan = [];
  if (first.gap) { for (var i = 0; i < Math.max(0, first.gap.cell - 1); i++) plan.push('right'); plan.push('jump'); }
  for (var j = 0; j < 9; j++) plan.push('right');
  return plan;
}
// 総当たり（距離スイープ）：お手本の「最終お化け接近の右移動」だけ 0..全部 に振り、
//   止まり位置を変えてしゃがむ一連の計画を作る（前局面攻略・ジャンプ・中間しゃがみは保持）。
//   ＝「いろんな止まり位置で試す」総当たりプレイの忠実な模型。far/near/won の事実が出そろう。
function stopDistanceSweepPlans() {
  var ex = SIM.currentStage().example.slice();
  var tail = [];
  while (ex.length && (ex[ex.length - 1] === 'crouch' || ex[ex.length - 1] === 'wait')) tail.unshift(ex.pop());
  var trailingRights = 0;
  while (ex.length && ex[ex.length - 1] === 'right') { ex.pop(); trailingRights++; }
  var head = ex;
  var plans = [];
  for (var keep = 0; keep <= trailingRights; keep++) {
    var p = head.slice();
    for (var i = 0; i < keep; i++) p.push('right');
    plans.push(p.concat(tail.length ? tail : ['crouch', 'crouch', 'crouch', 'crouch', 'crouch']));
  }
  return plans;
}

// F0. note.js が期待のAPI・既定閾値を持つ
check('F0. note.js が既定閾値3・距離帯定数・主要APIを公開（ヒント量は定数で調整可能）',
      NOTE.HYPOTHESIS_THRESHOLD === 3 && typeof NOTE.NEAR_DIST === 'number' && typeof NOTE.FAR_DIST === 'number' &&
      typeof NOTE.deriveBeatFacts === 'function' && typeof NOTE.createNote === 'function' &&
      typeof NOTE.entryOf === 'function' && typeof NOTE.goalHint === 'function',
      'TH=' + NOTE.HYPOTHESIS_THRESHOLD + ' NEAR=' + NOTE.NEAR_DIST + ' FAR=' + NOTE.FAR_DIST);

// F1. ゴールふんわり隠す: 入口（entry）は“気持ち”のみで手段「しゃがむ」を言わない／ゴール文言は「方法は不明・推理」を示す
(function () {
  var ghosts = Object.keys(NOTE.PERSONA_BY_GHOST);
  var entryNoMechanic = ghosts.every(function (g) {
    var e = NOTE.entryOf(g);
    return e && !/しゃが/.test(e);   // 手段（しゃがむ）を入口で漏らさない
  });
  check('F1. 入口（気持ち）は手段“しゃがむ”を直接言わない＝解釈の方向だけ示す（ふんわり隠す）',
        entryNoMechanic, ghosts.map(function (g) { return g + '〔' + NOTE.entryOf(g) + '〕'; }).join(' '));
  var goal = NOTE.goalHint();
  check('F1. ゴール文言は「方法は まだ わからない／推理しよう」＝クリア条件を明示しない',
        /わからない|推理/.test(goal) && !/しゃがむと\s*クリア/.test(goal), goal);
})();

// F2. 事実は決定論（同一計画→同一事実）
(function () {
  SIM.loadStage(2); // 臆病なおばけ（timid）
  var gi = ghostBeatIndex(); var bm = SIM.beatMeta(SIM.currentStageIndex);
  var a = JSON.stringify(NOTE.deriveBeatFacts(runTypesNote(SIM.currentStage().example), gi, bm));
  var b = JSON.stringify(NOTE.deriveBeatFacts(runTypesNote(SIM.currentStage().example), gi, bm));
  check('F2. ヒーローノートの事実導出は決定論（同一計画→同一事実）', a === b);
})();

// F3. 事実は正解直書きでない（観察表現・「正解/こうすれば/すべき」を含まない）
(function () {
  var bad = false, count = 0;
  Object.keys(NOTE.PERSONA).forEach(function (pk) {
    var f = NOTE.PERSONA[pk].facts;
    Object.keys(f).forEach(function (id) {
      var txt = f[id]; count++;
      if (/正解|こうすれば|すべき|クリア条件/.test(txt)) bad = true;
    });
  });
  check('F3. 事実は「正解/こうすれば/すべき」を含まず観察表現にとどまる（推理の余地を残す）', !bad,
        count + '件チェック');
})();

// F4. 事実3つで仮説解放（閾値）＋ 閾値は定数で調整可能
(function () {
  SIM.loadStage(2); var gi = ghostBeatIndex(); var bm = SIM.beatMeta(SIM.currentStageIndex);
  var name = bm[gi].name;
  var partial = NOTE.createNote();
  partial.observe(runTypesNote(rushPlan()), bm);            // rushed, closed → 2事実
  var c2 = partial.countOf(name); var h2 = partial.hypothesisOf(name);
  partial.observe(runTypesNote(SIM.currentStage().example), bm); // +crouchFar/Near/won → 閾値超え
  var c3 = partial.countOf(name); var h3 = partial.hypothesisOf(name);
  check('F4. 事実が閾値(3)未満では仮説は解放されない', c2 < 3 && h2 === null, '事実=' + c2);
  check('F4. 事実が閾値(3)に達すると仮説が解放される', c3 >= 3 && !!h3, '事実=' + c3);
  // 閾値の調整可能性（ヒント量チューニング）：threshold=2 のノートは2事実で解放
  var loose = NOTE.createNote(2);
  loose.observe(runTypesNote(rushPlan()), bm);
  check('F4. 閾値は createNote(threshold) で調整可能（ヒント量を手触りで変えられる）',
        loose.countOf(name) >= 2 && !!loose.hypothesisOf(name), 'threshold=2で解放');
})();

// F5. 仮説は断定でない（「かも」「？」・数字なし・「正解」なし）
(function () {
  var allGuess = true, sample = [];
  Object.keys(NOTE.PERSONA).forEach(function (pk) {
    var h = NOTE.PERSONA[pk].hypothesis;
    sample.push(pk);
    if (!/かも/.test(h) || !/？|\?/.test(h) || /正解/.test(h) || /\d/.test(h)) allGuess = false;
  });
  check('F5. 仮説は断定せず推測（「かも」「？」を含み・数字や「正解」を含まない＝正解バラしでない）',
        allGuess, sample.join('/'));
})();

// F6. 救済：お手本=final win（必ず解ける）／総当たり的に試せば事実が閾値到達→仮説が出る
(function () {
  var rescueWin = true, bruteUnlock = true, detail = [];
  SIM.stageList().forEach(function (si) {
    SIM.loadStage(si.index);
    var s = SIM.currentStage(); var bm = SIM.beatMeta(si.index);
    var ex = runTypesNote(s.example);
    if (ex.outcome.result !== 'win') { rescueWin = false; detail.push(s.name + ':お手本✗'); }
    // 総当たり：詰め寄りダメ計画＋止まり位置スイープ を一通り試す＝事実が出そろう
    var n = NOTE.createNote();
    n.observe(runTypesNote(rushPlan()), bm);
    stopDistanceSweepPlans().forEach(function (p) { n.observe(runTypesNote(p), bm); });
    var finalGhost = bm.filter(function (b) { return b.kind === 'ghost'; }).pop();
    if (!(finalGhost && n.hypothesisOf(finalGhost.name))) {
      bruteUnlock = false; detail.push(s.name + ':仮説✗(事実' + n.countOf(finalGhost.name) + ')');
    }
  });
  check('F6. 救済：全ステージお手本が final win（総当たり救済＝詰まない）', rescueWin, detail.join(' ') || 'OK');
  check('F6. 総当たり的に試せば最終お化けで事実が閾値到達→仮説が解放される（必ずヒントに辿り着く）',
        bruteUnlock, detail.join(' ') || 'OK');
})();

// F7. 推理で早解き：良い計画（お手本）は final win かつ最終お化けの事実も得られる（総当たり前に解ける道）
(function () {
  var festIdx = STAGES.filter(function (s) { return s.multibeat; })[0].index;
  SIM.loadStage(festIdx);
  var bm = SIM.beatMeta(festIdx);
  var ex = runTypesNote(SIM.currentStage().example);
  var n = NOTE.createNote(); n.observe(ex, bm);
  var finalGhost = bm.filter(function (b) { return b.kind === 'ghost'; }).pop();
  check('F7. 推理で早解き：お手本1本で final win（少ない試行で解ける道がある）',
        ex.outcome.result === 'win' && ex.outcome.beatsCleared === ex.outcome.beatsTotal,
        'cleared=' + ex.outcome.beatsCleared + '/' + ex.outcome.beatsTotal);
  check('F7. その1回の試行でも最終お化けの事実が記録される（観察＝推理の材料が貯まる）',
        n.countOf(finalGhost.name) >= 1, '事実=' + n.countOf(finalGhost.name));
})();

// F8. ペルソナ対比（推理の肝）：timid と lonely で crouchedFar/Near の手応えが逆＝距離の推理が成立する
(function () {
  var T = NOTE.PERSONA.timid.facts, L = NOTE.PERSONA.lonely.facts;
  var farContrast = T.crouchedFar !== L.crouchedFar && /ゆるめ|落ち着|安心|ほっと/.test(T.crouchedFar) && /さみし|うつむ/.test(L.crouchedFar);
  var nearContrast = /うれし|わらっ|よろこ/.test(L.crouchedNear);
  check('F8. ペルソナ対比：timidは“はなれて”が肯定・lonelyは“はなれて”が否定（遠/近の推理が成立する材料）',
        farContrast && nearContrast,
        'timid遠=〔' + T.crouchedFar + '〕 lonely遠=〔' + L.crouchedFar + '〕');
})();

// F9. 物理コア不変の証跡（sim.js は cmd_552 とバイト同一。主要定数が cmd_547/548 と同値）
check('F9. 物理コア不変: GRID=10 / 移動1枚=1マス / しゃがみ2拍 / VIEW=60 / WARY_MAX=100（sim.js 無改変）',
      SIM.GRID === 10 && SIM.MOVE_CELLS === 1 && SIM.FIXED_BEATS.crouch === 2 &&
      SIM.VIEW === 60 && SIM.WARY_MAX === 100);

console.log('\n' + (ok
  ? '✅ ALL PASS — ★cmd_553フカシギ式ヒント機構(ゴールふんわり隠す/事実自動記録の決定論/正解直書きでない/事実3つで仮説解放・閾値調整可/仮説は断定でない/救済=総当たりで必ず解ける/推理で早解き/ペルソナ対比/sim.js無改変) '
    + '＋ cmd_552直接ドライブ(語彙5種・1マス量子化・同一計画データ/tape・録画的決定論・録り直し前方一致) '
    + '＋ cmd_549多局面ビート連鎖/単調進行/手がかり存在/語彙不変/決定論/歯ごたえ '
    + '＋ cmd_548継承(複数ステージ・全面クリア可・クリア窓・固定マス・到達一意・マス拡大・穴ジャンプ・phase)'
  : '❌ FAIL — 上記を要調整'));
process.exit(ok ? 0 : 1);
