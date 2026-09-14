// 「リズムで あいうえお」の歌詞データ。
// 1行（あ行・か行…）につき、読む文が2つと、挿絵ファイル名を持ちます。emoji は挿絵がまだ無いときの仮表示です。
// 挿絵を差し替えるときは images フォルダの同じ名前の画像を置き換えるだけで大丈夫です。
const GOJUON_ROWS = [
  { id: "a", emoji: "🌅",  kana: "あ", row: "あいうえお", lines: ["あさだよ　おはよう　あいうえお", "あかるい　あさひが　でてきたよ"], image: "images/01_a.png" },
  { id: "ka", emoji: "☔", kana: "か", row: "かきくけこ", lines: ["かさして　かえろう　かきくけこ", "かぜが　つよくて　さむいなあ"], image: "images/02_ka.png" },
  { id: "sa", emoji: "🐟", kana: "さ", row: "さしすせそ", lines: ["さかなが　およぐよ　さしすせそ", "さらさら　せせらぎ　すずしいな"], image: "images/03_sa.png" },
  { id: "ta", emoji: "🥁", kana: "た", row: "たちつてと", lines: ["たいこを　たたこう　たちつてと", "とんとん　たのしい　たいこの　おと"], image: "images/04_ta.png" },
  { id: "na", emoji: "🤝", kana: "な", row: "なにぬねの", lines: ["なかよく　ならんで　なにぬねの", "にっこり　わらって　なかまだね"], image: "images/05_na.png" },
  { id: "ha", emoji: "🏃", kana: "は", row: "はひふへほ", lines: ["はしって　はねよう　はひふへほ", "はやいぞ　ひろばを　ひとまわり"], image: "images/06_ha.png" },
  { id: "ma", emoji: "🍙", kana: "ま", row: "まみむめも", lines: ["まいにち　まんぷく　まみむめも", "みんなで　もぐもぐ　おいしいな"], image: "images/07_ma.png" },
  { id: "ya", emoji: "🧑‍🤝‍🧑", kana: "や", row: "やいゆえよ", lines: ["やさしく　やろうね　やいゆえよ", "ゆっくり　やれば　できるよね"], image: "images/08_ya.png" },
  { id: "ra", emoji: "🍜", kana: "ら", row: "らりるれろ", lines: ["らくらく　ラーメン　らりるれろ", "るんるん　りずむで　つるつるっ"], image: "images/09_ra.png" },
  { id: "wa", emoji: "💃", kana: "わ", row: "わをん",     lines: ["わらって　わになる　わをん", "わいわい　みんなで　おどろうよ"], image: "images/10_wa.png" },
];
