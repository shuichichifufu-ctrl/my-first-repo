"""毎日の実行入口。  python -m scanner.run --config tickers.yaml [--dry-run]"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date

from . import chart, data, notify, state as st
from .waves import Params, clean_frame, find_candidates


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="tickers.yaml")
    ap.add_argument("--dry-run", action="store_true", help="通知せず結果を表示する")
    ap.add_argument("--state", default=".state/notified.json")
    ap.add_argument("--out", default="out")
    a = ap.parse_args(argv)

    cfg = data.load_config(a.config)
    params = Params(**cfg.get("params", {}))
    webhook = os.environ.get("DISCORD_WEBHOOK_URL", "")
    if not a.dry_run and not webhook:
        print("DISCORD_WEBHOOK_URL が設定されていません。--dry-run で試すか、環境変数を設定してください。", file=sys.stderr)
        return 2

    instruments = [i for grp in cfg["instruments"].values() for i in grp]
    frames, failed = data.fetch_all(instruments, cfg.get("period", "2y"))
    os.makedirs(a.out, exist_ok=True)
    state = st.load(a.state)
    today = date.today()

    all_c = []
    for ins in instruments:
        df = frames.get(ins["symbol"])
        if df is None:
            continue
        for c in find_candidates(ins["symbol"], ins["name"], df, params):
            all_c.append((c, df))
    fresh = {c.key() for c in st.select_new([x[0] for x in all_c], state)}
    new = {c.key(): (c, df) for c, df in all_c if c.key() in fresh}

    closes = {s: float(df["Close"].iloc[-1]) for s, df in frames.items()}
    withdrawn = st.find_withdrawn(state, closes, today)

    print(f"取得成功 {len(frames)} / 失敗 {len(failed)} / 候補 {len(all_c)} / 新規通知 {len(new)} / 取り下げ {len(withdrawn)}")
    send_errors = 0

    def deliver(text, img=None) -> bool:
        """送信に成功したら True。失敗しても他の通知と記録の保存は続ける。"""
        nonlocal send_errors
        if a.dry_run:
            return True
        try:
            notify.send_discord(webhook, text, img)
            return True
        except Exception as e:  # noqa: BLE001
            send_errors += 1
            print(f"送信失敗: {type(e).__name__}: {e}", file=sys.stderr)
            return False

    for c, df in new.values():
        text = notify.format_candidate(c)
        img = chart.draw(clean_frame(df), c,
                         os.path.join(a.out, f"{c.symbol.replace('^', '').replace('=', '_')}_{c.direction}.png"))
        print("\n" + text)
        if deliver(text, img):
            st.remember(state, c, today)  # 送れなかった候補は記録せず、翌日もう一度試す
    for _, e, cl in withdrawn:
        text = notify.format_withdrawn(e["symbol"], e["name"], cl, e["inv"], e["direction"], e.get("inv_major"))
        print("\n" + text)
        deliver(text)
    if failed:
        text = notify.format_failures(failed)
        print("\n" + text)
        deliver(text)
    if not frames:
        deliver("【エラー】全銘柄の取得に失敗しました。データ元の障害か、ネットワークを確認してください。")
    if not a.dry_run:
        st.save(a.state, state)
    if not frames:
        return 1
    return 3 if send_errors else 0


if __name__ == "__main__":
    sys.exit(main())
