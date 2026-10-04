"""us_dst_active / server_offset を zoneinfo(America/New_York)と1時間刻みで全照合(2003-2032)。"""
import os, sys, warnings
import numpy as np, pandas as pd
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
warnings.filterwarnings("ignore")
from core.config import DayBoundaryConfig
from core.data import server_offset, us_dst_active, server_to_utc

idx = pd.date_range("2003-01-01", "2032-12-31 23:00", freq="1h")
ny = idx.tz_localize("UTC").tz_convert(ZoneInfo("America/New_York"))
true_dst = np.array([bool(t.dst()) for t in ny])
mine = us_dst_active(idx)
bad = np.flatnonzero(true_dst != mine)
print("DST判定の不一致(時間):", len(bad), "/", len(idx))
if len(bad):
    print(idx[bad][:10], "…")
for sh in (-1, 0, 1):
    day = DayBoundaryConfig(gmt_shift_hours=sh)
    off = server_offset(idx, day).astype("int64") / 3.6e12
    expect = (ny.tz_localize(None) - idx).total_seconds() / 3600 * 0 + 0  # placeholder
    ny_off = np.array([t.utcoffset().total_seconds() / 3600 for t in ny])
    exp = 7 + ny_off + sh
    print(f"shift={sh:+d}: server_offset の不一致 = {int((np.abs(off - exp) > 1e-9).sum())}")
# 往復
day = DayBoundaryConfig()
srv = idx + pd.to_timedelta(server_offset(idx, day))
back = server_to_utc(srv, day)
mism = np.flatnonzero(back.to_numpy() != idx.to_numpy())
wk = idx[mism]
print("server_to_utc 往復の不一致:", len(mism), "うち平日(月-金)の時刻:", int(((wk.dayofweek >= 0) & (wk.dayofweek <= 4)).sum()))
print(wk[:6])
