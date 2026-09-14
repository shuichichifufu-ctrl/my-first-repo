// ページの並び：あ行「よむ」→ あ行「え」→ か行「よむ」→ か行「え」→ … の順に交互になります。
const PAGES = [];
GOJUON_ROWS.forEach((row, i) => {
  PAGES.push({ type: "read", row, rowIndex: i });
  PAGES.push({ type: "art",  row, rowIndex: i });
});

let current = 0;
const pageEl = document.getElementById("page");
const pageInfo = document.getElementById("pageInfo");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const rowNav = document.getElementById("rowNav");
const autoSpeak = document.getElementById("autoSpeak");

// 上の「あ か さ …」ボタン
GOJUON_ROWS.forEach((row, i) => {
  const b = document.createElement("button");
  b.textContent = row.kana;
  b.title = row.row;
  b.addEventListener("click", () => go(i * 2));
  rowNav.appendChild(b);
});

// URL の #番号 でページを覚えておく（リロードしても同じページ）
const fromHash = parseInt(location.hash.replace("#", ""), 10);
if (!Number.isNaN(fromHash) && fromHash >= 1 && fromHash <= PAGES.length) current = fromHash - 1;

function go(n) {
  if (n < 0 || n >= PAGES.length) return;
  stopSpeaking();
  current = n;
  location.hash = String(n + 1);
  render();
}

function render() {
  const p = PAGES[current];
  pageEl.className = "page " + p.type;
  pageEl.innerHTML = "";
  // アニメーションをやり直すための小技
  void pageEl.offsetWidth;

  if (p.type === "read") renderRead(p.row);
  else renderArt(p.row);

  pageInfo.textContent = `${current + 1} / ${PAGES.length}`;
  prevBtn.disabled = current === 0;
  nextBtn.disabled = current === PAGES.length - 1;
  [...rowNav.children].forEach((b, i) => b.classList.toggle("active", i === p.rowIndex));

  if (p.type === "read" && autoSpeak.checked) speakAll(p.row);
}

function renderRead(row) {
  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = "こえに だして よもう";
  const name = document.createElement("h2");
  name.className = "rowname";
  name.textContent = row.row;
  pageEl.append(badge, name);

  row.lines.forEach((text, i) => {
    const d = document.createElement("div");
    d.className = "line";
    d.textContent = text;
    d.title = "クリックすると この1行だけ よみあげます";
    d.addEventListener("click", () => speakLines(row, [i]));
    pageEl.appendChild(d);
  });

  const btn = document.createElement("button");
  btn.className = "speak";
  btn.textContent = "🔊 おてほんを きく";
  btn.addEventListener("click", () => speakAll(row));
  pageEl.appendChild(btn);

  const note = document.createElement("div");
  note.className = "note";
  note.textContent = canSpeak()
    ? "おてほんの あとに、じぶんでも よんでみよう。つぎのページに 絵が あるよ。"
    : "このブラウザは よみあげに 対応していません。じぶんの こえで よんでみよう。";
  pageEl.appendChild(note);
}

function renderArt(row) {
  const img = document.createElement("img");
  img.alt = `${row.row} の挿絵`;
  img.src = row.image;
  img.addEventListener("error", () => {
    // 画像がまだ無いときは、行の文字を大きく出しておく
    img.remove();
    const ph = document.createElement("div");
    ph.className = "placeholder";
    ph.innerHTML = `<div class="emoji">${row.emoji}</div><div class="big">${row.kana}</div><div>${row.row}</div><small>挿絵はまだ入っていません（${row.image} を置くと表示されます）</small>`;
    pageEl.prepend(ph);
  });
  const cap = document.createElement("div");
  cap.className = "caption";
  cap.textContent = row.lines.join("　／　");
  pageEl.append(img, cap);
}

/* ---- よみあげ（ブラウザの音声合成を使用。ネット接続やAPIキーは不要） ---- */
function canSpeak() { return "speechSynthesis" in window; }
function stopSpeaking() { if (canSpeak()) speechSynthesis.cancel(); }

function pickJapaneseVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find(v => v.lang === "ja-JP") || voices.find(v => v.lang.startsWith("ja")) || null;
}

function speakAll(row) { speakLines(row, row.lines.map((_, i) => i)); }

function speakLines(row, indexes) {
  if (!canSpeak()) return;
  stopSpeaking();
  const lineEls = pageEl.querySelectorAll(".line");
  indexes.forEach((i, k) => {
    const u = new SpeechSynthesisUtterance(row.lines[i].replace(/　/g, " "));
    u.lang = "ja-JP";
    u.rate = 0.8;   // 子ども向けにゆっくり
    u.pitch = 1.1;
    const v = pickJapaneseVoice();
    if (v) u.voice = v;
    u.onstart = () => { lineEls.forEach(e => e.classList.remove("speaking")); lineEls[i]?.classList.add("speaking"); };
    u.onend = () => { if (k === indexes.length - 1) lineEls.forEach(e => e.classList.remove("speaking")); };
    speechSynthesis.speak(u);
  });
}
if (canSpeak()) speechSynthesis.onvoiceschanged = () => {};

/* ---- ページ移動 ---- */
prevBtn.addEventListener("click", () => go(current - 1));
nextBtn.addEventListener("click", () => go(current + 1));
document.addEventListener("keydown", e => {
  if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { e.preventDefault(); go(current + 1); }
  if (e.key === "ArrowLeft") { e.preventDefault(); go(current - 1); }
});
let touchX = null;
document.addEventListener("touchstart", e => { touchX = e.touches[0].clientX; }, { passive: true });
document.addEventListener("touchend", e => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) go(dx < 0 ? current + 1 : current - 1);
  touchX = null;
});
window.addEventListener("hashchange", () => {
  const n = parseInt(location.hash.replace("#", ""), 10) - 1;
  if (!Number.isNaN(n) && n !== current && n >= 0 && n < PAGES.length) { current = n; render(); }
});

render();
