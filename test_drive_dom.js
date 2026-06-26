/* =====================================================================
 * test_drive_dom.js — cmd_552 直接ドライブ入力の "game.js 配線" 検証（node + モックDOM）
 *   実行: node test_drive_dom.js
 *
 * 本環境はヘッドレスでブラウザを起動できないため、最小限の DOM をモックして
 * sim.js → game.js を実際に読み込み、game.js の入力レイヤー（キーボード／トグル）を
 * 機械的に叩いて以下を担保する（test_sim.js が sim 層を担保するのに対し、こちらは game.js 配線）:
 *   G1. 直接ドライブ式に切替えると drivepad が表示され cardpad が隠れる（同一画面のモード切替が成立）
 *   G2. 方向キー（→）を押すと、その軌跡が計画に記録される＝#blocks に行動カードが1枚ずつ増える（録画）
 *   G3. 連続移動も内部は固定マス1マス単位に量子化（記録された各カードの到達差が >1マス にならない）
 *   G4. 動かす＝記録であって即実行ではない（押下後も mode は計画中＝録画。▶を押すまで実行されない）
 *   G5. Backspace 相当（ひとつ戻す）で直前の記録が取り消せる（録り直しが軽量）
 *   G6. ジャンプは押しっぱでも1回ずつ（OSオートリピート e.repeat は無視）
 *   G7. カード式へ戻すと cardpad が表示され drivepad が隠れる（往復トグルが成立）
 * ===================================================================== */

// -------- 最小モック DOM --------
function MockEl(tag) {
  this.tagName = tag || 'div';
  this.children = [];
  this._cls = {};
  this.style = {};
  this._attr = {};
  this._on = {};
  this._text = '';
  this.value = 0; this.min = 0; this.max = 0; this.step = 0;
  this.onclick = null;
  var self = this;
  this.classList = {
    add: function (c) { self._cls[c] = true; },
    remove: function (c) { delete self._cls[c]; },
    toggle: function (c, on) { if (on === undefined) on = !self._cls[c]; if (on) self._cls[c] = true; else delete self._cls[c]; },
    contains: function (c) { return !!self._cls[c]; }
  };
}
Object.defineProperty(MockEl.prototype, 'innerHTML', {
  get: function () { return this._html || ''; },
  set: function (v) { this._html = v; if (v === '') this.children = []; }
});
Object.defineProperty(MockEl.prototype, 'textContent', {
  get: function () { return this._text; },
  set: function (v) { this._text = String(v); }
});
MockEl.prototype.appendChild = function (c) { this.children.push(c); return c; };
MockEl.prototype.addEventListener = function (type, fn) { (this._on[type] = this._on[type] || []).push(fn); };
MockEl.prototype.removeEventListener = function () {};
MockEl.prototype.getAttribute = function (k) { return (k in this._attr) ? this._attr[k] : null; };
MockEl.prototype.setAttribute = function (k, v) { this._attr[k] = v; };
MockEl.prototype.fire = function (type, ev) { (this._on[type] || []).forEach(function (fn) { fn(ev || {}); }); };
MockEl.prototype.getContext = function () { return makeCtx(); };

// Canvas 2D コンテキストは「何を呼んでも no-op、グラデは {addColorStop:no-op}」のプロキシで足りる
function makeCtx() {
  return new Proxy({}, {
    get: function (_t, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
        return function () { return { addColorStop: function () {} }; };
      if (prop === 'canvas') return { width: 760, height: 300 };
      return function () {};
    },
    set: function () { return true; }
  });
}

var registry = {};
function el(id) { if (!registry[id]) { registry[id] = new MockEl(); registry[id].id = id; } return registry[id]; }

function mkBtn(attrs) { var b = new MockEl('button'); for (var k in attrs) b.setAttribute(k, attrs[k]); return b; }

var documentMock = {
  getElementById: function (id) { return el(id); },
  createElement: function (tag) { return new MockEl(tag); },
  querySelectorAll: function (sel) {
    if (sel === 'button[data-add]')
      return ['right', 'left', 'jump', 'crouch', 'wait'].map(function (t) { return mkBtn({ 'data-add': t }); });
    if (sel === 'button[data-drive]')
      return [['left', '1'], ['right', '1'], ['jump', '0'], ['crouch', '1'], ['wait', '1']]
        .map(function (p) { return mkBtn({ 'data-drive': p[0], 'data-rep': p[1] }); });
    return [];
  },
  _on: {},
  addEventListener: function (type, fn) { (this._on[type] = this._on[type] || []).push(fn); },
  fire: function (type, ev) { (this._on[type] || []).forEach(function (fn) { fn(ev || {}); }); }
};
var windowMock = { _on: {}, addEventListener: function (t, fn) { (this._on[t] = this._on[t] || []).push(fn); } };

// rAF は「最新コールバックを保持し、harness が手動で進める」方式（自動ループさせない）
var rafCb = null;
global.requestAnimationFrame = function (cb) { rafCb = cb; return 1; };
function flush(frames) { for (var i = 0; i < frames; i++) { var cb = rafCb; rafCb = null; if (cb) cb(1000 + i * 16); } }

global.window = windowMock;
global.document = documentMock;
windowMock.SIM = require('./sim.js');     // game.js は window.SIM を読む
windowMock.NOTE = require('./note.js');   // ★ cmd_553: game.js は window.NOTE（フカシギ式ヒント機構）も読む

// keydown/keyup を document に投げるヘルパ（preventDefault はダミー）
function key(type, code, opts) {
  opts = opts || {};
  documentMock.fire(type, { code: code, key: opts.key || code, repeat: !!opts.repeat, preventDefault: function () {} });
}

// -------- game.js を実行（ここで例外が出れば即 FAIL）--------
var ok = true;
function check(label, cond, extra) {
  console.log((cond ? '  PASS ' : '  FAIL ') + label + (extra ? '  — ' + extra : ''));
  if (!cond) ok = false;
}
try {
  require('./game.js');
} catch (e) {
  console.log('  FAIL game.js 読み込みで例外: ' + e.message + '\n' + e.stack);
  process.exit(1);
}
console.log('=== cmd_553 game.js 配線テスト（フカシギ式ヒント機構＋直接ドライブ・モックDOM）===\n');

// 起動時に intro モーダルが出る → ドライブキーは無効。introstart を押して閉じる。
el('introstart').fire('click');
check('準備. intro モーダルを閉じられる（会話→ステージ開始）', !el('intromodal').classList.contains('show'));

// ★ cmd_553 配線: 起動時に ヒーローノート パネルがレンダリングされ、入口（気持ち）と「まだ発見なし」が出る。
(function () {
  var html = el('heronote').innerHTML || '';
  check('G0(553). ヒーローノートが表示され入口（気持ち）が出る（クリア方法は明示しない＝ふんわり）',
        el('heronote').style.display === 'block' && /ヒーローノート/.test(html) &&
        /💭/.test(html) && /まだ 発見なし/.test(html),
        'display=' + el('heronote').style.display);
})();

// G1. 直接ドライブ式へ切替（トグル）
el('imDrive').onclick();
check('G1. ドライブ式に切替で drivepad 表示・cardpad 非表示（同一画面のモード切替）',
      el('drivepad').style.display === 'block' && el('cardpad').style.display === 'none',
      'drivepad=' + el('drivepad').style.display + ' cardpad=' + el('cardpad').style.display);

// #blocks の中身からカード列を読む（renderBlocks が chip を append している）
function recordedCards() {
  var chips = el('blocks').children.filter(function (c) { return /(^|\s)chip(\s|$)/.test(c.className || ''); });
  return chips.map(function (chip) {
    var type = ((chip.className || '').match(/t-(\w+)/) || [])[1];
    var dst = chip.children.filter(function (k) { return (k.className || '') === 'dst'; })[0];
    var reach = null;
    if (dst) { var m = (dst.textContent || '').match(/(\d+)→(\d+)/); if (m) reach = (+m[2]) - (+m[1]); }
    return { type: type, reach: reach };
  });
}

// G2. → を3回押す（押下→離す）。各押下で1枚記録される＝軌跡が計画に記録される。
key('keydown', 'ArrowRight'); key('keyup', 'ArrowRight');
key('keydown', 'ArrowRight'); key('keyup', 'ArrowRight');
key('keydown', 'ArrowRight'); key('keyup', 'ArrowRight');
var cards = recordedCards();
check('G2. 方向キー→を押すと軌跡が計画に記録される（#blocks に行動カードが増える）',
      cards.length === 3 && cards.every(function (c) { return c.type === 'right'; }),
      '記録=' + cards.length + '枚 [' + cards.map(function (c) { return c.type; }).join(',') + ']');

// G3. 量子化: 記録された各移動カードの到達差が >1マス にならない（1マス刻み）
var moves = cards.filter(function (c) { return c.reach !== null; });
check('G3. 連続移動も1マス単位に量子化（記録カードの到達差が >1マス にならない）',
      moves.length >= 1 && moves.every(function (c) { return Math.abs(c.reach) <= 1; }),
      '到達差=' + moves.map(function (c) { return c.reach; }).join(','));

// G4. 動かす＝記録であって即実行でない：押下後も banner は「録画/記録」を示し、▶を押すまで再生されない
var banner = el('banner').textContent;
check('G4. 動かす＝記録（録画）であって即時実行ではない（banner が記録/録画状態を示す）',
      /録画|記録/.test(banner), 'banner="' + banner + '"');

// G5. ひとつ戻す（録り直し）— undoDrive で直前の記録を取消
el('undoDrive').onclick();
check('G5. ひとつ戻す（録り直し）で直前の記録を取り消せる', recordedCards().length === 2,
      '残り=' + recordedCards().length + '枚');

// G6. ジャンプは押しっぱ（e.repeat）でも1回ずつ：repeat=true は無視される
var before = recordedCards().length;
key('keydown', 'Space', { key: ' ' });                 // 1回目（記録される）
key('keydown', 'Space', { key: ' ', repeat: true });   // OSオートリピート（無視）
key('keyup', 'Space', { key: ' ' });
var after = recordedCards();
var jumps = after.filter(function (c) { return c.type === 'jump'; }).length;
check('G6. ジャンプは押しっぱでも1回だけ記録（OSオートリピートを無視）',
      after.length === before + 1 && jumps === 1, '増分=' + (after.length - before) + ' jump数=' + jumps);

// follow 追従の tick が例外なく回る（録画ヘッドの先読み追従）
try { flush(5); check('G+. 録画追従の描画ループが例外なく回る', true); }
catch (e) { check('G+. 録画追従の描画ループが例外なく回る', false, e.message); }

// ▶ 再生を押しても例外が出ない（記録した計画の再生）
try { el('play').onclick(); flush(3); check('G+. ▶再生が例外なく走る（記録した計画を再生）', true); }
catch (e) { check('G+. ▶再生が例外なく走る', false, e.message); }

// G7. カード式へ戻す（往復トグル）
el('imCard').onclick();
check('G7. カード式へ戻すと cardpad 表示・drivepad 非表示（往復トグルが成立）',
      el('cardpad').style.display === 'flex' && el('drivepad').style.display === 'none',
      'cardpad=' + el('cardpad').style.display + ' drivepad=' + el('drivepad').style.display);

console.log('\n' + (ok
  ? '✅ ALL PASS — game.js 配線: ドライブ切替/方向キーで記録/1マス量子化/記録≠即実行/録り直し/ジャンプ単発/往復トグル'
  : '❌ FAIL — 上記を要調整'));
process.exit(ok ? 0 : 1);
