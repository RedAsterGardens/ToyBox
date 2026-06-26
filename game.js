/* =====================================================================
 * game.js — 描画と操作（Canvas 横スクロール側面ビュー + 固定マスカードUI + ステージ選択
 *           ＋ ★cmd_549: ステージ前会話モーダル / 多局面（ビート）進行バー / 道中メッセージ）。
 *           判定/物理は持たず sim.js に委譲する。
 *
 * ◆ cmd_549 の描画/UI 変更（壁打ち反映）
 *   (1) ★ ステージ前会話モーダル（#intromodal）:
 *       ステージ選択時に intro 会話を**画面に**表示（性格/背景＋推理の手がかり）。
 *       cmd_544 の失敗（手がかりが画面に出ずネタバレ退化）を回避するため、必ず画面提示する。
 *   (2) ★ 多局面（ビート）進行バー（#beatbar）＋ 局面情報（#beatinfo）:
 *       1本の計画が今どの局面かを可視化。局面区切り・現在局面ハイライト・道中の手がかり clue を出す。
 *   (3) ★ 穴を per-frame で描画:
 *       局面ごとに穴が変わる（travel 局面が穴を持つ）ため、床/穴は**その時刻の snapshot の gapL/gapR**
 *       で描く（モジュール現在値ではなく tape の値）。これでスクラブしても局面ごとの穴が正しく出る。
 *
 * ◆ ★cmd_553: フカシギ式ヒント機構の統合（note.js）
 *   (A) ゴールを **ふんわり** 隠す：sim.js の直接的な道中 clue（「だいぶ手前で止まってしゃがんで待って」等）は
 *       画面に出さず、代わりに note.js の「入口」＝お化けの“気持ち”だけを提示（解釈の方向は示すが手段は隠す）。
 *   (B) **ヒーローノート**パネル（#heronote）：▶再生が末尾まで進むたび heroNote.observe(sim,beats) を呼び、
 *       「行動がお化けに与えた影響」を事実として自動記録。事実が3つ貯まると“仮説”を解放（断定しない）。
 *   (C) 救済：困ったら「お手本をなぞる」（必ず final win）＝総当たり救済の最終手段。推理が立てば総当たり前に早解きも可。
 *   ＝判定/物理コア sim.js は cmd_552 と **バイト完全同一**（フカシギ層は note.js に隔離・game.js が橋渡し）。
 *
 * ◆ 先読み=再生の一致（cmd_543〜548 から不変）
 *   計画が変わるたび SIM.simulatePlan(plan) を1回走らせ tape[] を作る。
 *   スクラブも再生も同じ tape を読む → プレビューと再生は原理的に一致（局面進行込み）。
 * ===================================================================== */
(function () {
  'use strict';
  var S = window.SIM;
  var N = window.NOTE;     // ★ cmd_553: フカシギ式ヒント機構（決定論ノートエンジン。無くても描画は動くよう防御的に扱う）

  // ---- Canvas ----
  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');
  var W = 760, H = 300;
  canvas.width = W; canvas.height = H;

  // ★ ステージごとに床幅が違う → ビュー（world幅/スケール/セル幅）を切替時に再計算
  var WORLD_W = 132, SX = W / WORLD_W, CELL_PX = S.GRID * SX;
  var GROUND_PY = H - 58;
  var YSCALE = 6.0;
  function applyStageView() {
    WORLD_W = S.X_MAX + 8;                 // 右端に少し余白
    SX = W / WORLD_W;
    CELL_PX = S.GRID * SX;
  }
  function px(x) { return x * SX; }
  function feetPy(snap) { return GROUND_PY - snap.y * YSCALE; }

  // ---- DOM ----
  var slider   = document.getElementById('timeline');
  var elClock  = document.getElementById('clock');
  var elBanner = document.getElementById('banner');
  var elHint   = document.getElementById('hint');
  var elBlocks = document.getElementById('blocks');
  var elTabs   = document.getElementById('stagetabs');
  var elBlurb  = document.getElementById('stageblurb');
  var elBeatbar  = document.getElementById('beatbar');
  var elBeatinfo = document.getElementById('beatinfo');
  // ★ cmd_553: ヒーローノート（フカシギ式ヒント機構の表示）
  var elNote     = document.getElementById('heronote');
  // intro modal
  var elModal     = document.getElementById('intromodal');
  var elModalName = document.getElementById('introtitle');
  var elModalBody = document.getElementById('introbody');
  var elModalBtn  = document.getElementById('introstart');
  // ★ cmd_552: 入力方式トグル＋ドライブパッド
  var elImCard   = document.getElementById('imCard');
  var elImDrive  = document.getElementById('imDrive');
  var elCardpad  = document.getElementById('cardpad');
  var elDrivepad = document.getElementById('drivepad');

  // ---- 状態 ----
  var plan = { blocks: [] };
  var sim  = null;
  var endT = 0;
  var t = 0;
  var mode = 'plan';
  var selected = -1;
  var lastFrameMs = null;
  var sawClosed = false;
  var lastBeatSeen = 0;          // 再生中の局面遷移検出用
  var beats = [];                // 現ステージの局面メタ
  var beatRanges = [];           // 各局面の [tStart,tEnd]（進行バー用）

  // ★ cmd_553: ヒーローノート（試行をまたいで事実を蓄積→3つで仮説解放）。ステージ切替で reset。
  var heroNote = N ? N.createNote() : null;
  var observedEndForT = -1;      // 同じ再生末尾で二重 observe しないためのガード

  // ★ cmd_552: 入力方式（'card'=従来カード式 / 'drive'=直接ドライブ式）。
  //   両方とも同じ plan.blocks[] を作る＝同じデータ・同じ sim・同じステージ。入力レイヤーだけが違う。
  var inputMode = 'card';
  // ★ 録画中の先読み追従フラグ。drive で1マス記録するたび true にして、再生ヘッド t を末尾 endT へ
  //   滑らかに歩かせる（＝「動かしている」手触り。ただし実体は tape を読むだけ＝決定論・即実行ではない）。
  var followEnd = false;
  var repeaters = {};            // 押しっぱなし連続記録用（id -> intervalId|null）
  var REPEAT_MS = 140;           // 押しっぱ時、1マス（1ブロック）を記録する間隔[ms]
  var DRIVE_TYPES = { right: 1, left: 1, jump: 1, crouch: 1, wait: 1 };   // ドライブで記録できる語彙＝5種のまま
  var REPEATABLE  = { right: 1, left: 1, crouch: 1, wait: 1 };            // 押しっぱで連続記録する種（jumpは1回ずつ）

  // ===================== ステージ選択 =====================
  function renderTabs() {
    elTabs.innerHTML = '';
    S.stageList().forEach(function (st) {
      var b = document.createElement('button');
      b.className = 'tab' + (st.index === S.currentStageIndex ? ' on' : '');
      b.textContent = st.name + (st.multibeat ? ' ★多局面' : '');
      b.addEventListener('click', function () { selectStage(st.index); });
      elTabs.appendChild(b);
    });
    elBlurb.textContent = S.currentStage().blurb;
  }
  function selectStage(idx) {
    stopAllDrive(); followEnd = false;
    S.loadStage(idx);
    applyStageView();
    beats = S.beatMeta(idx);
    plan = { blocks: [] }; selected = -1; t = 0; mode = 'plan'; sawClosed = false; lastBeatSeen = 0;
    if (heroNote) heroNote.reset();           // ★ 別ステージ＝別のお化け。ノートはやり直し
    observedEndForT = -1;
    rebuild(); renderTabs(); renderBlocks(); renderBeatbar(); renderBeatInfo(); renderNotePanel(); setBanner(); draw();
    showIntro(idx);
  }

  // ===================== ★ ステージ前会話モーダル =====================
  function showIntro(idx) {
    var intro = S.stageIntro(idx);
    elModalName.textContent = S.currentStage().name;
    elModalBody.innerHTML = '';
    intro.forEach(function (line) {
      var row = document.createElement('div'); row.className = 'introline';
      var who = document.createElement('span'); who.className = 'who'; who.textContent = line.who;
      var tx  = document.createElement('span'); tx.className = 'tx'; tx.textContent = line.text;
      row.appendChild(who); row.appendChild(tx);
      elModalBody.appendChild(row);
    });
    // ★ cmd_553: フカシギ式の“読み方”ガイド。クリア方法（手段）は直接言わず、推理の入口だけ示す。
    var tip = document.createElement('div'); tip.className = 'introtip';
    tip.innerHTML = (N ? N.goalHint() : '❓ 心を ひらく方法を 見つけよう。') +
                    '<br>※ <b>やり方は教えてもらえない</b>。動かして 観察し、下の <b>ヒーローノート</b>に たまる “発見” から ' +
                    'この子に 何が効くか <b>推理</b>しよう（事実が ３つ たまると “仮説” が ひらめく）。';
    elModalBody.appendChild(tip);
    elModal.classList.add('show');
  }
  function hideIntro() { elModal.classList.remove('show'); }
  elModalBtn.addEventListener('click', hideIntro);

  // ===================== シミュレート（計画→tape） =====================
  function rebuild() {
    sim = S.simulatePlan(plan);
    endT = sim.tape.length ? sim.tape[sim.tape.length - 1].t : 0;
    var maxT = Math.max(0.001, endT);
    slider.min = 0; slider.max = maxT; slider.step = 0.02;
    if (t > maxT) t = maxT;
    slider.value = t;
    computeBeatRanges();
  }
  function snapAt(time) {
    if (!sim || sim.tape.length === 0) return null;
    var idx = Math.round(time / sim.dt);
    if (idx < 0) idx = 0;
    if (idx >= sim.tape.length) idx = sim.tape.length - 1;
    return sim.tape[idx];
  }
  // 各局面が tape 上で占める時間帯（進行バー描画用）
  function computeBeatRanges() {
    beatRanges = [];
    if (!sim) return;
    var total = beats.length;
    for (var b = 0; b < total; b++) beatRanges.push({ start: null, end: null });
    sim.tape.forEach(function (sn) {
      var bi = sn.beatIndex;
      if (bi < 0 || bi >= total) return;
      if (beatRanges[bi].start === null) beatRanges[bi].start = sn.t;
      beatRanges[bi].end = sn.t;
    });
  }

  // ===================== 計画編集 =====================
  function toPlan() { if (mode !== 'plan') { mode = 'plan'; } }

  function addBlock(type) {
    toPlan();
    plan.blocks.push({ type: type });
    selected = plan.blocks.length - 1;
    t = 0; rebuild(); renderBlocks(); renderBeatbar(); setBanner(); draw();
  }
  function delBlock() {
    if (selected < 0) { flashHint('削除するカードをクリックで選んでな。'); return; }
    toPlan();
    plan.blocks.splice(selected, 1);
    selected = Math.min(selected, plan.blocks.length - 1);
    t = 0; rebuild(); renderBlocks(); renderBeatbar(); setBanner(); draw();
  }
  function moveBlock(dir) {
    if (selected < 0) return;
    var j = selected + dir;
    if (j < 0 || j >= plan.blocks.length) return;
    toPlan();
    var tmp = plan.blocks[selected]; plan.blocks[selected] = plan.blocks[j]; plan.blocks[j] = tmp;
    selected = j;
    t = 0; rebuild(); renderBlocks(); renderBeatbar(); setBanner(); draw();
  }
  function clearPlan() {
    stopAllDrive(); followEnd = false;
    plan.blocks = []; selected = -1; t = 0;
    mode = 'plan'; rebuild(); renderBlocks(); renderBeatbar(); setBanner(); draw();
  }
  function loadExample() {
    plan = S.examplePlan(); selected = -1; t = 0; mode = 'plan';
    rebuild(); renderBlocks(); renderBeatbar(); setBanner();
    var multi = S.stageList()[S.currentStageIndex].multibeat;
    flashHint('お手本（' + S.currentStage().name + '）＝こまった時の救済（必ずクリアできる1本）。' +
      (multi ? '1本の計画で「橋を渡る→手前の子→裂け目→奥の子」を順に攻略する。▶で観察すればノートに発見もたまる。'
             : '最適でなくてOK＝しゃがみが多少前後しても隣り合える。▶で観察すればノートに発見もたまる。'));
    draw();
  }

  // =====================================================================
  // ★ cmd_552: 直接ドライブ型入力（録画的に計画へ記録する）
  //   核心: 「動かす」は **即時実行ではなく plan.blocks[] への記録**。方向キー等を押すと
  //   1マス分の行動カード（→/←/jump/crouch/wait の5種のまま）が plan に追記され、
  //   再シミュレートして tape を作り、再生ヘッドを末尾へ滑らかに歩かせる（先読み=記録の可視化）。
  //   ＝カード式と完全に同じデータ・同じ sim・同じ決定論。違うのは「計画の作り方」だけ。
  //   ＝連続移動も内部は固定マス1マス単位に量子化（押しっぱ→ REPEAT_MS ごとに1ブロック）。
  // =====================================================================
  function driveAppend(type) {
    if (!DRIVE_TYPES[type]) return;
    if (mode !== 'plan') { mode = 'plan'; }      // 再生/結果中に動かしたら計画編集へ戻す
    plan.blocks.push({ type: type });            // ★ カード式 addBlock と同一のデータを追記（=同じ plan）
    selected = plan.blocks.length - 1;
    rebuild();                                   // 同じ simulatePlan で tape を作り直す（決定論）
    followEnd = true;                            // 末尾へ追従（録画ヘッドが歩く）
    if (t > endT) t = endT;
    renderBlocks(); renderBeatbar(); renderBeatInfo(); setBanner(); draw();
  }
  // 軽量な録り直し（巻き戻して組み直し）：直前の1マスを取り消す
  function undoLastDrive() {
    if (plan.blocks.length === 0) { flashHint('まだ記録がないで。方向キー/WASDで動かしてみて。'); return; }
    mode = 'plan';
    plan.blocks.pop();
    selected = plan.blocks.length - 1;
    rebuild();
    followEnd = true;
    if (t > endT) t = endT;
    renderBlocks(); renderBeatbar(); renderBeatInfo(); setBanner(); draw();
    flashHint('ひとつ戻した（録り直し）。続けて動かせば計画を組み直せる。');
  }

  // 押しっぱなし連続記録（id 単位で多重起動を防ぐ）。repeat=false の種（jump）は1回だけ。
  function startDrive(id, type, repeat) {
    if (inputMode !== 'drive') return;
    if (repeaters.hasOwnProperty(id)) return;
    driveAppend(type);
    repeaters[id] = repeat ? setInterval(function () { driveAppend(type); }, REPEAT_MS) : null;
  }
  function stopDrive(id) {
    if (!repeaters.hasOwnProperty(id)) return;
    if (repeaters[id] !== null) clearInterval(repeaters[id]);
    delete repeaters[id];
  }
  function stopAllDrive() { Object.keys(repeaters).forEach(stopDrive); }

  // 入力方式の切替（同じ plan を保持＝同じ計画データのまま入力レイヤーだけ差し替え）
  function setInputMode(m) {
    inputMode = (m === 'drive') ? 'drive' : 'card';
    stopAllDrive();
    followEnd = false;
    if (elCardpad)  elCardpad.style.display  = (inputMode === 'card')  ? 'flex'  : 'none';
    if (elDrivepad) elDrivepad.style.display = (inputMode === 'drive') ? 'block' : 'none';
    if (elImCard)  elImCard.classList.toggle('on',  inputMode === 'card');
    if (elImDrive) elImDrive.classList.toggle('on', inputMode === 'drive');
    setBanner();
    if (inputMode === 'drive') {
      flashHint('直接ドライブ式：方向キー/WASDで主人公を動かすと、その軌跡が計画に記録される（押しっぱで連続移動＝1マスずつ量子化）。動かす＝記録（即実行ではない）。▶で計画通り再生・⟲やBackspaceで録り直し。');
    } else {
      flashHint('カード式：ボタンで行動カードを足して計画を組む。直接ドライブ式と同じ計画データ・同じステージ・同じ sim。テンポと直感性を見比べてな。');
    }
    draw();
  }

  function cardValueLabel(type, blockInfo) {
    var kind = S.BLOCK_DEFS[type].kind;
    if (kind === 'jump') {
      if (blockInfo) return '穴越え ' + Math.abs(blockInfo.reachCells) + 'マス';
      return '穴越え';
    }
    if (kind === 'wait') return S.fixedAmountOf(type) + ' 拍';
    if (blockInfo && blockInfo.blocked) return '1マス→0(詰)';
    return '1 マス';
  }

  function renderBlocks() {
    elBlocks.innerHTML = '';
    if (plan.blocks.length === 0) {
      var e = document.createElement('span');
      e.className = 'empty';
      e.textContent = '↑のボタンで行動カードを足して計画を組んでな（→を並べた枚数だけ進む。多局面ステージは1本の長い計画で順に攻略）';
      elBlocks.appendChild(e);
      return;
    }
    var snap = snapAt(t);
    var activeIdx = (snap && (mode === 'playing' || mode === 'paused')) ? snap.blockIndex : -1;
    plan.blocks.forEach(function (b, i) {
      var def = S.BLOCK_DEFS[b.type];
      var info = (sim && sim.blocks[i]) ? sim.blocks[i] : null;
      var chip = document.createElement('div');
      chip.className = 'chip t-' + b.type + (i === selected ? ' sel' : '') + (i === activeIdx ? ' active' : '');
      var lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = def.label;
      var val = document.createElement('div'); val.className = 'val'; val.textContent = cardValueLabel(b.type, info);
      chip.appendChild(lbl); chip.appendChild(val);
      if (info && def.kind !== 'wait') {
        var dst = document.createElement('div'); dst.className = 'dst';
        dst.textContent = info.startCell + '→' + info.endCell + 'マス目';
        chip.appendChild(dst);
      }
      chip.addEventListener('click', function () {
        if (mode !== 'plan') toPlan();
        selected = i; renderBlocks(); setBanner(); draw();
      });
      elBlocks.appendChild(chip);
    });
  }

  // ===================== ★ 多局面（ビート）進行バー =====================
  function renderBeatbar() {
    elBeatbar.innerHTML = '';
    if (beats.length <= 1) { elBeatbar.style.display = 'none'; return; }   // 単一お化けは出さない
    elBeatbar.style.display = 'flex';
    var snap = snapAt(t);
    var curBeat = snap ? snap.beatIndex : 0;
    beats.forEach(function (b, i) {
      var seg = document.createElement('div');
      seg.className = 'beatseg' + (i === curBeat ? ' on' : '') + (i < curBeat ? ' done' : '') + ' k-' + b.kind;
      var ttl = (b.kind === 'ghost') ? ('☻ ' + (b.name || 'おばけ')) : '➛ 渡る';
      seg.innerHTML = '<span class="bn">局面' + (i + 1) + '</span><span class="bt">' + ttl + (b.final ? ' ★' : '') + '</span>';
      elBeatbar.appendChild(seg);
    });
  }
  // 現在局面の情報（道中メッセージ＋★フカシギ式の“入口”）を出す。
  //   ★ cmd_553: sim.js の直接的な手段 clue（「手前で止まってしゃがんで」等）は **出さない**。
  //      代わりに note.js の entry＝お化けの“気持ち”だけを提示（解釈の方向は示すが、やり方は隠す＝ふんわり）。
  function entryHintFor(beat) {
    if (!beat || beat.kind !== 'ghost') return '';
    return N ? N.entryOf(beat.name) : (beat.clue || '');
  }
  function renderBeatInfo() {
    if (!elBeatinfo) return;
    if (beats.length <= 1) {
      var gb0 = beats[0];
      var entry0 = entryHintFor(gb0);
      if (gb0 && (gb0.banner || entry0)) {
        elBeatinfo.style.display = 'block';
        elBeatinfo.innerHTML = '<b>' + (gb0.banner || '') + '</b>' +
          (entry0 ? '<br><span class="clue">💭 ' + entry0 + '</span>' : '');
      } else { elBeatinfo.style.display = 'none'; }
      return;
    }
    var snap = snapAt(t);
    var bi = snap ? snap.beatIndex : 0;
    var b = beats[bi] || beats[0];
    elBeatinfo.style.display = 'block';
    var msg = '<b>局面' + (bi + 1) + '/' + beats.length + '：' + (b.banner || '') + '</b>';
    var entry = entryHintFor(b);
    if (entry) msg += '<br><span class="clue">💭 ' + entry + '</span>';
    elBeatinfo.innerHTML = msg;
  }

  // ===================== ★ cmd_553: ヒーローノート（フカシギ式ヒント機構の表示）=====================
  //   現ステージの ghost 局面ごとに「入口（気持ち）／自動記録された事実／仮説（3つで解放）」を出す。
  //   ＝プレイヤーは これを読んで「この子に何が効くか」を推理する。正解は直書きしない。
  function renderNotePanel() {
    if (!elNote) return;
    if (!N || !heroNote) { elNote.style.display = 'none'; return; }
    var ghostBeats = beats.filter(function (b) { return b.kind === 'ghost'; });
    if (ghostBeats.length === 0) { elNote.style.display = 'none'; return; }
    elNote.style.display = 'block';

    var html = '<div class="notettl">📓 ヒーローノート <span class="notesub">— 試すたび“発見”が増える。事実が ' +
               heroNote.threshold + ' つで「仮説」がひらめく</span></div>';

    ghostBeats.forEach(function (b) {
      var name = b.name || 'おばけ';
      var facts = heroNote.factsOf(name);
      var prog = heroNote.progressOf(name);
      var hyp = heroNote.hypothesisOf(name);
      var won = heroNote.wonOf(name);

      html += '<div class="notecard' + (won ? ' won' : '') + '">';
      html += '<div class="noteghost">☻ ' + esc(name) + (won ? ' <span class="notewon">♥ 心を ひらいた</span>' : '') + '</div>';
      // 入口（気持ち）— 解釈の方向だけ
      html += '<div class="noteentry">💭 ' + esc(N.entryOf(name)) + '</div>';
      // 事実リスト（自動記録）
      html += '<div class="notefacts">';
      if (facts.length === 0) {
        html += '<div class="noteempty">（まだ 発見なし。動かして 観察してみよう）</div>';
      } else {
        facts.forEach(function (f) { html += '<div class="notefact">・' + esc(f.text) + '</div>'; });
      }
      html += '</div>';
      // 進捗（あと何個で仮説か）— ●○ のドットで（気持ちの数値ゲージではない）
      var dots = '';
      for (var i = 0; i < prog.need; i++) dots += (i < prog.have ? '●' : '○');
      // 仮説（3つ解放）or 進捗
      if (hyp) {
        html += '<div class="notehyp">' + esc(hyp) + '</div>';
      } else {
        var rest = Math.max(0, prog.need - prog.have);
        html += '<div class="noteprog"><span class="dots">' + dots + '</span> ' +
                '発見 ' + prog.have + '／' + prog.need +
                (rest > 0 ? '（あと ' + rest + 'つで 仮説）' : '') + '</div>';
      }
      html += '</div>';
    });

    elNote.innerHTML = html;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  // ★ 1回の試行（再生し終えた計画）の tape から事実を取り込み、ノートを更新する。
  function observeTrial() {
    if (!N || !heroNote || !sim) return;
    heroNote.observe(sim, beats);
    renderNotePanel();
  }

  // ===================== 再生 =====================
  function play() {
    if (plan.blocks.length === 0) {
      flashHint(inputMode === 'drive' ? 'まず方向キー/WASDで主人公を動かして計画を記録してな。' : 'まず行動カードを足して計画を組んでな。');
      return;
    }
    stopAllDrive(); followEnd = false;           // 録画追従を止めてから頭出し再生（記録≠実行を明確に）
    if (mode === 'paused' && t < endT) { mode = 'playing'; lastFrameMs = null; setBanner(); return; }
    observedEndForT = -1;                         // ★ cmd_553: この再生で観察し直す（末尾まで行ったらノートへ取込）
    t = 0; slider.value = 0; mode = 'playing'; lastFrameMs = null; sawClosed = false; lastBeatSeen = 0; setBanner();
  }
  function pause() { if (mode === 'playing') { mode = 'paused'; setBanner(); } }
  function rewind() { stopAllDrive(); followEnd = false; t = 0; slider.value = 0; mode = 'plan'; sawClosed = false; lastBeatSeen = 0; setBanner(); renderBlocks(); renderBeatbar(); renderBeatInfo(); draw(); }

  function tick(now) {
    if (mode === 'playing' && sim) {
      if (lastFrameMs == null) lastFrameMs = now;
      var dt = Math.min(0.05, (now - lastFrameMs) / 1000);
      lastFrameMs = now;
      t += dt;
      var snap = snapAt(t);
      if (snap) {
        if (snap.closed && !sawClosed) { sawClosed = true; flashHint('心を閉ざしてしまった…（詰め寄りすぎ）。少し待てば開き直す。⟲で計画し直しも可。'); }
        // ★ 局面が進んだ瞬間に通知（多局面の段階クリアの手応え）
        if (snap.beatIndex > lastBeatSeen) {
          var prev = beats[lastBeatSeen];
          if (prev) {
            if (prev.kind === 'ghost') flashHint('「' + (prev.name || 'おばけ') + '」となかよくなった！　次の局面へ。');
            else flashHint('渡れた！　次の局面へ。');
          }
          lastBeatSeen = snap.beatIndex;
        }
      }
      if (t >= endT) {
        t = endT; mode = 'result'; setBanner();
        // ★ cmd_553: 1回の試行を最後まで再生し終えた＝観察完了。事実をノートへ取り込む（同一末尾の二重取込は防ぐ）。
        if (endT !== observedEndForT) { observedEndForT = endT; observeTrial(); }
      }
      slider.value = Math.min(t, endT);
      renderBlocks(); renderBeatbar(); renderBeatInfo();
    } else if (followEnd && mode === 'plan' && sim) {
      // ★ cmd_552: 録画中の先読み追従 — 記録した末尾(endT)へ再生ヘッドを滑らかに歩かせる。
      //   これは「動かしている」見た目だが、実体は tape を読むだけ＝即実行ではない（決定論は不変）。
      if (lastFrameMs == null) lastFrameMs = now;
      var ddt = Math.min(0.05, (now - lastFrameMs) / 1000);
      lastFrameMs = now;
      if (t < endT - 1e-4) {
        var rate = (endT - t > 0.8) ? 4 : 1.6;   // 遅れが大きいほど速く追いつく（押しっぱの連続移動でも滑らか）
        t = Math.min(endT, t + ddt * rate);
        slider.value = t;
        renderBlocks(); renderBeatbar(); renderBeatInfo();
      } else { t = endT; slider.value = t; }
    } else {
      lastFrameMs = null;
    }
    draw();
    requestAnimationFrame(tick);
  }

  slider.addEventListener('input', function () {
    stopAllDrive(); followEnd = false;          // 手動スクラブしたら録画追従は解除（自分で先読みを見ている）
    if (mode === 'playing') mode = 'paused';
    if (mode === 'result')  mode = 'paused';
    t = parseFloat(slider.value);
    setBanner(); renderBlocks(); renderBeatbar(); renderBeatInfo(); draw();
  });

  // ===================== 描画 =====================
  function draw() {
    ctx.clearRect(0, 0, W, H);
    var snap = snapAt(t) || { playerX: S.PLAYER_START, y: 0, grounded: true, crouching: false,
                              ghostX: S.GHOST_START, phase: 'calm', dist: 0, result: null, closed: false,
                              blockIndex: -1, beatIndex: 0, gapL: S.GAP_L, gapR: S.GAP_R };
    drawSky();
    drawGround(snap);
    drawGrid(snap);
    drawCurrentCell(snap);
    drawReachPreview(snap);
    drawDistanceTrail(snap);
    drawGhost(snap);
    drawPlayer(snap);
    if (snap.result === 'win') drawWinSparkle(snap);
    var cell = S.xToCell(snap.playerX);
    var beatTxt = (beats.length > 1) ? ' ／ 局面 ' + (snap.beatIndex + 1) + '/' + beats.length : '';
    elClock.textContent = 't=' + t.toFixed(1) + 's ／ 主人公 ' + cell + 'マス目' + beatTxt;
  }

  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, GROUND_PY);
    g.addColorStop(0, '#141826'); g.addColorStop(1, '#0d1119');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND_PY);
    ctx.fillStyle = '#cfd8dc'; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(W - 70, 52, 26, 0, 7); ctx.fill();
    ctx.fillStyle = '#141826';
    ctx.beginPath(); ctx.arc(W - 60, 46, 24, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ★ 床/穴は snapshot の gapL/gapR（その時刻の局面の穴）で描く
  function drawGround(snap) {
    var gapL = snap.gapL, gapR = snap.gapR;
    var hasGap = (gapR > gapL) && (gapL >= S.X_MIN);
    ctx.fillStyle = '#222c39';
    if (hasGap) {
      ctx.fillRect(0, GROUND_PY, px(gapL), H - GROUND_PY);
      ctx.fillRect(px(gapR), GROUND_PY, px(S.X_MAX) - px(gapR), H - GROUND_PY);
    } else {
      ctx.fillRect(0, GROUND_PY, px(S.X_MAX), H - GROUND_PY);
    }
    ctx.strokeStyle = '#3a4757'; ctx.lineWidth = 2;
    ctx.beginPath();
    if (hasGap) {
      ctx.moveTo(0, GROUND_PY); ctx.lineTo(px(gapL), GROUND_PY);
      ctx.moveTo(px(gapR), GROUND_PY); ctx.lineTo(px(S.X_MAX), GROUND_PY);
    } else {
      ctx.moveTo(0, GROUND_PY); ctx.lineTo(px(S.X_MAX), GROUND_PY);
    }
    ctx.stroke();
    if (hasGap) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(px(gapL), GROUND_PY, px(gapR) - px(gapL), 10);
    }
  }

  function drawGrid(snap) {
    var gapL = snap.gapL, gapR = snap.gapR;
    var maxc = S.MAXCELL;
    for (var c = 0; c < maxc; c++) {
      var xl = S.cellToX(c), xr = S.cellToX(c + 1);
      var midx = (xl + xr) / 2;
      var overPit = (midx > gapL && midx < gapR);
      if (!overPit && (c % 2 === 0)) {
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(px(xl), GROUND_PY, px(xr) - px(xl), H - GROUND_PY);
      }
    }
    for (var k = 0; k <= maxc; k++) {
      var wx = S.cellToX(k);
      if (wx > gapL && wx < gapR) continue;
      var x = px(wx);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, GROUND_PY); ctx.lineTo(x, GROUND_PY + 16); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(k), x, GROUND_PY + 28);
    }
  }

  function drawCurrentCell(snap) {
    if (!snap.grounded) return;
    var cell = S.xToCell(snap.playerX);
    var cx = px(S.cellToX(cell));
    ctx.fillStyle = 'rgba(79,195,247,0.10)';
    ctx.strokeStyle = 'rgba(79,195,247,0.35)'; ctx.lineWidth = 1.5;
    var w = CELL_PX, x0 = cx - w / 2;
    ctx.fillRect(x0, GROUND_PY - 4, w, 8);
    ctx.beginPath(); ctx.moveTo(x0, GROUND_PY); ctx.lineTo(x0 + w, GROUND_PY); ctx.stroke();
  }

  function drawReachPreview(snap) {
    if (!sim) return;
    var idx = -1;
    if (mode === 'plan' && selected >= 0) idx = selected;
    else if ((mode === 'playing' || mode === 'paused' || mode === 'result') && snap.blockIndex >= 0) idx = snap.blockIndex;
    if (idx < 0 || !sim.blocks[idx]) return;
    var info = sim.blocks[idx];
    var def = S.BLOCK_DEFS[info.type];
    var topY = GROUND_PY - 78;

    var sx = px(info.startX), ex = px(info.endX);
    var color = REACH_COLOR[info.type] || '#4fc3f7';

    if (def.kind === 'move' || def.kind === 'jump') {
      ctx.fillStyle = hexA(color, 0.12);
      var lo = Math.min(sx, ex), hi = Math.max(sx, ex);
      ctx.fillRect(lo, GROUND_PY - 2, Math.max(hi - lo, 3), 16);

      ctx.strokeStyle = hexA(color, 0.9); ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      if (def.kind === 'jump') {
        var mx = (sx + ex) / 2, arcH = 46;
        ctx.moveTo(sx, topY + 10);
        ctx.quadraticCurveTo(mx, topY - arcH + 10, ex, topY + 10);
      } else {
        ctx.moveTo(sx, topY + 10); ctx.lineTo(ex, topY + 10);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ex, GROUND_PY - 20); ctx.lineTo(ex - 7, GROUND_PY - 32); ctx.lineTo(ex + 7, GROUND_PY - 32);
      ctx.closePath(); ctx.fill();
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText((info.blocked ? '止まる' : 'ここまで') + ' ' + info.endCell + 'マス目', ex, GROUND_PY - 38);
    } else {
      ctx.fillStyle = color;
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText((info.type === 'crouch' ? 'しゃがんで' : '立って') + info.amount + '拍 待つ', sx, GROUND_PY - 38);
      ctx.strokeStyle = hexA(color, 0.7); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, GROUND_PY - 10, 11, 0, 7); ctx.stroke();
    }
  }
  var REACH_COLOR = {
    right: '#4fc3f7', left: '#b39ddb', jump: '#ffd54f', crouch: '#ff8aab', wait: '#80cbc4'
  };
  function hexA(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function drawDistanceTrail(snap) {
    var x0 = Math.min(snap.playerX, snap.ghostX), x1 = Math.max(snap.playerX, snap.ghostX);
    var n = Math.max(0, Math.floor((x1 - x0) / 8));
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (var i = 1; i <= n; i++) {
      var x = x0 + (x1 - x0) * (i / (n + 1));
      ctx.beginPath(); ctx.arc(px(x), GROUND_PY - 6, 2, 0, 7); ctx.fill();
    }
  }

  var GHOST_COLOR = {
    calm: '#90a4ae', curious: '#ffd180', approaching: '#ff8aab',
    wary: '#b39ddb', scared: '#5c6bc0', closed: '#78909c', win: '#ff4d88'
  };
  function drawGhost(snap) {
    var phase = snap.phase || 'calm';
    var color = GHOST_COLOR[phase] || '#90a4ae';
    var toward = (snap.playerX <= snap.ghostX) ? -1 : 1;
    var bob = Math.sin(t * 2.2) * 3;
    var tremble = (phase === 'scared') ? Math.sin(t * 34) * 2.2 : 0;
    var cx = px(snap.ghostX) + tremble;
    var cy = GROUND_PY - 40 + bob;
    var r = 22;

    var lean = 0;
    if (phase === 'scared' || phase === 'wary') lean = -toward * 0.20;
    else if (phase === 'approaching') lean = toward * 0.16;
    else if (phase === 'curious') lean = toward * 0.08;

    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(lean);
    ctx.fillStyle = color;
    ctx.globalAlpha = (phase === 'closed') ? 0.7 : 0.95;
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0);
    var waves = 4, baseY = r * 0.9;
    ctx.lineTo(r, baseY);
    for (var i = 0; i < waves; i++) {
      var x1 = r - (2 * r) * ((i + 0.5) / waves);
      var x2 = r - (2 * r) * ((i + 1) / waves);
      ctx.quadraticCurveTo(x1, baseY + 6, x2, baseY);
    }
    ctx.lineTo(-r, 0);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;

    var eyeY = -3, eyeDX = 7;
    if (phase === 'closed') {
      ctx.strokeStyle = '#2b343d'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-eyeDX - 3, eyeY); ctx.lineTo(-eyeDX + 3, eyeY);
      ctx.moveTo(eyeDX - 3, eyeY); ctx.lineTo(eyeDX + 3, eyeY); ctx.stroke();
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-eyeDX, eyeY, 4, 0, 7); ctx.arc(eyeDX, eyeY, 4, 0, 7); ctx.fill();
      var look = 0;
      if (phase === 'curious' || phase === 'approaching' || phase === 'win') look = toward * 1.6;
      else if (phase === 'wary' || phase === 'scared') look = -toward * 1.6;
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(-eyeDX + look, eyeY, 2, 0, 7); ctx.arc(eyeDX + look, eyeY, 2, 0, 7); ctx.fill();
    }
    if (phase === 'approaching' || phase === 'win') {
      ctx.fillStyle = 'rgba(255,120,160,0.5)';
      ctx.beginPath(); ctx.arc(-eyeDX - 2, eyeY + 7, 2.8, 0, 7); ctx.arc(eyeDX + 2, eyeY + 7, 2.8, 0, 7); ctx.fill();
    }
    ctx.restore();

    // ★ お化けの名札（多局面で誰と向き合っているか分かるように）
    var b = beats[snap.beatIndex];
    if (b && b.kind === 'ghost' && b.name) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(b.name, cx, cy - r - 22);
    }

    if (phase === 'scared') drawMark(cx, cy - r - 8, '!!', '#5c6bc0');
    else if (phase === 'wary') drawMark(cx, cy - r - 8, '!', '#b39ddb');
    else if (phase === 'curious') drawMark(cx, cy - r - 8, '?', '#ffd180');
    else if (phase === 'approaching') drawMark(cx, cy - r - 8, '♪', '#ff8aab');
  }
  function drawMark(x, y, txt, color) {
    ctx.fillStyle = color; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(txt, x, y);
  }

  function drawPlayer(snap) {
    var x = px(snap.playerX);
    var feet = feetPy(snap);
    var crouch = snap.crouching;
    var bodyW = crouch ? CELL_PX * 0.82 : CELL_PX * 0.56;
    var bodyH = crouch ? CELL_PX * 0.42 : CELL_PX * 0.78;
    var headR = CELL_PX * 0.19;
    var headY = feet - bodyH - headR + 2;
    ctx.fillStyle = '#4fc3f7';
    roundRect(x - bodyW / 2, feet - bodyH, bodyW, bodyH, 6); ctx.fill();
    ctx.beginPath(); ctx.arc(x, headY, headR, 0, 7); ctx.fill();
    ctx.fillStyle = '#0d1119';
    ctx.beginPath(); ctx.arc(x + headR * 0.4, headY - 1, headR * 0.22, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(px(snap.playerX), GROUND_PY + 2, CELL_PX * 0.34, 3.5, 0, 0, 7); ctx.fill();
    if (crouch) drawMark(x, headY - headR - 6, '…', '#80cbc4');
  }

  function drawWinSparkle(snap) {
    var mx = px((snap.playerX + snap.ghostX) / 2);
    var my = GROUND_PY - 62;
    ctx.fillStyle = '#ffd54f'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('♥', mx, my + Math.sin(t * 3) * 3);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ===================== バナー/ヒント =====================
  function setBanner() {
    if (mode === 'result' && sim) {
      if (sim.outcome.result === 'win') {
        elBanner.style.color = '#69f0ae';
        var allBeats = (beats.length > 1) ? '（' + sim.outcome.beatsTotal + '局面ぜんぶ攻略！）' : '';
        elBanner.textContent = '★ 隣り合えた！ 信頼が育ってお化けが心を開いた' + allBeats + '（t=' + sim.outcome.time.toFixed(1) + 's）';
      } else {
        elBanner.style.color = '#ffd54f';
        var prog = (beats.length > 1)
          ? '（局面 ' + sim.outcome.beatsCleared + '/' + sim.outcome.beatsTotal + ' まで到達）'
          : '';
        elBanner.textContent = 'まだ最後まで届いていない' + prog + ' — 近くで「しゃがむ」を増やす／間合いを読み直す。⟲で計画し直し'
          + (sim.outcome.softFails > 0 ? '（途中で' + sim.outcome.softFails + '回 心を閉ざした：詰め寄りすぎ）' : '');
      }
      return;
    }
    // ★ cmd_552: ドライブ式の計画中は「記録」であることを明示（録画＝即実行ではない）
    if (mode === 'plan' && inputMode === 'drive') {
      elBanner.style.color = '#ff8aab';
      elBanner.textContent = '🎮 直接ドライブ式（録画）— 方向キー/WASDで動かすと軌跡が計画に記録される（即実行ではない）。' +
                             (plan.blocks.length ? '記録 ' + plan.blocks.length + 'マス。▶で計画通り再生（先読み=再生は必ず一致）' : '動かして計画を作ってな');
      return;
    }
    var map = {
      plan:    ['#4fc3f7', '計画中（カード式）— →は1枚=1マス。多局面ステージは1本の長い計画で局面を順に攻略する'],
      playing: ['#9ccc65', '再生中… 先読みした通り（同じマス目・同じ局面進行）で実行される'],
      paused:  ['#ffd54f', '一時停止 — スクラブで局面の流れを確認 / ▶で再開']
    };
    var s = map[mode] || map.plan;
    elBanner.style.color = s[0]; elBanner.textContent = s[1];
  }

  var hintTimer = null;
  function flashHint(msg) {
    elHint.textContent = msg;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { elHint.textContent = ''; }, 5200);
  }

  // ===================== ボタン配線 =====================
  Array.prototype.forEach.call(document.querySelectorAll('button[data-add]'), function (btn) {
    btn.addEventListener('click', function () { addBlock(btn.getAttribute('data-add')); });
  });
  document.getElementById('moveL').onclick  = function () { moveBlock(-1); };
  document.getElementById('moveR').onclick   = function () { moveBlock(+1); };
  document.getElementById('del').onclick     = delBlock;
  document.getElementById('play').onclick    = play;
  document.getElementById('pause').onclick    = pause;
  document.getElementById('reset').onclick    = rewind;
  document.getElementById('clear').onclick     = clearPlan;
  document.getElementById('example').onclick   = loadExample;
  document.getElementById('replay').onclick    = function () { showIntro(S.currentStageIndex); };

  // ===================== ★ cmd_552: 入力方式トグル＋ドライブ配線 =====================
  if (elImCard)  elImCard.onclick  = function () { setInputMode('card'); };
  if (elImDrive) elImDrive.onclick = function () { setInputMode('drive'); };
  var elUndo = document.getElementById('undoDrive');
  if (elUndo) elUndo.onclick = undoLastDrive;

  // 画面上のドライブボタン（押しっぱ対応：pointerdown で記録開始、離す/外れるで停止）。
  // キーボードが無い環境（タッチ等）でも直接ドライブを操作できるようにする。
  Array.prototype.forEach.call(document.querySelectorAll('button[data-drive]'), function (btn) {
    var type = btn.getAttribute('data-drive');
    var repeat = btn.getAttribute('data-rep') === '1';
    var id = 'btn:' + type;
    btn.addEventListener('pointerdown', function (e) { e.preventDefault(); startDrive(id, type, repeat); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      btn.addEventListener(ev, function () { stopDrive(id); });
    });
  });

  // キーボード操作（方向キー/WASD/Space/Z）。inputMode==='drive' のときだけ作用。
  //   押しっぱは OS の auto-repeat（e.repeat）を無視し、自前の REPEAT_MS 間隔で1マスずつ量子化記録。
  var KEYMAP = {
    ArrowRight: 'right', KeyD: 'right',
    ArrowLeft:  'left',  KeyA: 'left',
    ArrowUp:    'jump',  KeyW: 'jump', Space: 'jump',
    ArrowDown:  'crouch', KeyS: 'crouch',
    KeyZ: 'wait'
  };
  document.addEventListener('keydown', function (e) {
    if (inputMode !== 'drive') return;
    if (elModal && elModal.classList.contains('show')) return;   // 会話モーダル表示中は無効
    if (e.key === 'Backspace') { e.preventDefault(); undoLastDrive(); return; }
    var type = KEYMAP[e.code];
    if (!type) return;
    e.preventDefault();                       // 矢印/Space のページスクロールを止める
    if (e.repeat) return;                     // OS 連打は無視（自前の間隔で記録）
    startDrive('key:' + type, type, !!REPEATABLE[type]);
  });
  document.addEventListener('keyup', function (e) {
    var type = KEYMAP[e.code];
    if (type) stopDrive('key:' + type);
  });
  window.addEventListener('blur', stopAllDrive);   // フォーカスを失ったら連続記録を止める（押しっぱ事故防止）

  // ===================== 起動 =====================
  S.loadStage(0); applyStageView();
  beats = S.beatMeta(0);
  rebuild(); renderTabs(); renderBlocks(); renderBeatbar(); renderBeatInfo(); renderNotePanel(); setBanner(); draw();
  setInputMode('card');     // 既定はカード式（トグルで直接ドライブ式へ。見比べられる）
  showIntro(0);
  requestAnimationFrame(tick);
})();
