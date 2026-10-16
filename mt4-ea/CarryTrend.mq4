//+------------------------------------------------------------------+
//| CarryTrend.mq4                                                   |
//| スワップ（金利差）の受け取れる向きに、12か月トレンドが同じ向きの   |
//| ときだけポジションを持つ、1日1回判断のEA（試作版）。               |
//|                                                                  |
//| 研究結果（trading-research/）で、主要通貨28ペア・2000〜2026年・    |
//| 費用込みでシャープレシオ0.25前後。大きく勝てる手法ではなく、        |
//| 「長期で小さくプラスになりやすい」程度の期待値であることに注意。   |
//+------------------------------------------------------------------+
#property strict
#property version   "0.10"
#property description "Carry x 12-month trend, daily decision (prototype)"

enum StrategyMode
  {
   STRAT_CARRY_TREND = 0, // キャリー×トレンド一致（推奨）
   STRAT_CARRY_ONLY  = 1, // キャリーのみ
   STRAT_TREND_ONLY  = 2  // 12か月トレンドのみ
  };

enum CarrySource
  {
   CARRY_FROM_SWAP   = 0, // 業者のスワップ値から判定（実運用・デモ用）
   CARRY_FROM_MANUAL = 1  // 手入力（ストラテジーテスター用）
  };

input StrategyMode Mode            = STRAT_CARRY_TREND;
input CarrySource  CarryFrom       = CARRY_FROM_SWAP;
input int          ManualCarryDir  = 1;     // 手入力時: 1=買いがプラススワップ, -1=売りがプラス, 0=なし
input double       MinCarryPct     = 1.0;   // スワップが年率この%未満なら持たない（ポイント表示の業者のみ判定）
input int          TrendDays       = 252;   // トレンド判定の日数（約12か月）
input int          VolDays         = 60;    // 振れ幅を測る日数
input double       TargetVolPct    = 3.0;   // このペアだけで目指す年間の振れ幅（口座の%）
input double       MaxLots         = 1.0;   // ロットの上限
input double       ResizeBand      = 0.5;   // 目標ロットから50%以上ずれたら持ち直す
input double       StopATRMult     = 6.0;   // 非常用の損切り（日足ATRの何倍か、0で無し）
input int          MaxSpreadPoints = 50;    // これより広いスプレッドでは売買しない
input int          SlippagePoints  = 30;
input int          MagicNumber     = 20261016;
input bool         AllowShort      = true;  // 売りも使う

datetime g_doneDay = 0;

double SwapAnnualPct(double swapPoints);

//+------------------------------------------------------------------+
int OnInit()
  {
   if(TrendDays < 20 || VolDays < 10 || TargetVolPct <= 0)
      return(INIT_PARAMETERS_INCORRECT);
   if(IsTesting() && CarryFrom == CARRY_FROM_SWAP)
      Print("注意: テスターではスワップ値が現在の設定で固定されます。過去の検証には CarryFrom=手入力 を使ってください。");
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   Comment("");
  }

//+------------------------------------------------------------------+
//| 1=買い有利, -1=売り有利, 0=どちらも受け取れない                    |
//+------------------------------------------------------------------+
int CarryDirection()
  {
   if(CarryFrom == CARRY_FROM_MANUAL)
      return(ManualCarryDir > 0 ? 1 : (ManualCarryDir < 0 ? -1 : 0));
   double sl = MarketInfo(Symbol(), MODE_SWAPLONG);
   double ss = MarketInfo(Symbol(), MODE_SWAPSHORT);
   int d = 0;
   if(sl > 0 && sl > ss) d = 1;
   if(ss > 0 && ss > sl) d = -1;
   if(d != 0 && SwapAnnualPct(d > 0 ? sl : ss) < MinCarryPct) d = 0;
   return(d);
  }

//+------------------------------------------------------------------+
//| スワップ（1ロット1日分）を、建玉の金額に対する年率%に直す。          |
//| ポイント表示（SWAPTYPE=0）の業者だけ計算でき、それ以外は判定しない。 |
//+------------------------------------------------------------------+
double SwapAnnualPct(double swapPoints)
  {
   if((int)MarketInfo(Symbol(), MODE_SWAPTYPE) != 0) return(MinCarryPct);  // 計算できないので素通し
   double price = iClose(NULL, PERIOD_D1, 1);
   if(price <= 0) return(0);
   return(swapPoints * Point * 365.0 / price * 100.0);
  }

//+------------------------------------------------------------------+
//| 前日の終値が TrendDays 日前より高ければ1、低ければ-1               |
//+------------------------------------------------------------------+
int TrendDirection()
  {
   if(iBars(NULL, PERIOD_D1) < TrendDays + 2) return(0);
   double now  = iClose(NULL, PERIOD_D1, 1);
   double past = iClose(NULL, PERIOD_D1, 1 + TrendDays);
   if(now <= 0 || past <= 0) return(0);
   if(now > past) return(1);
   if(now < past) return(-1);
   return(0);
  }

//+------------------------------------------------------------------+
//| 日足終値の対数変化から年率の変動率を推定                           |
//+------------------------------------------------------------------+
double AnnualVol()
  {
   if(iBars(NULL, PERIOD_D1) < VolDays + 3) return(0);
   double sum = 0, sum2 = 0;
   for(int i = 1; i <= VolDays; i++)
     {
      double a = iClose(NULL, PERIOD_D1, i);
      double b = iClose(NULL, PERIOD_D1, i + 1);
      if(a <= 0 || b <= 0) return(0);
      double r = MathLog(a / b);
      sum  += r;
      sum2 += r * r;
     }
   double mean = sum / VolDays;
   double var  = sum2 / VolDays - mean * mean;
   if(var <= 0) return(0);
   return(MathSqrt(var * 252.0));
  }

//+------------------------------------------------------------------+
int DesiredDirection()
  {
   int c = CarryDirection();
   int t = TrendDirection();
   int d = 0;
   if(Mode == STRAT_CARRY_TREND) d = (c != 0 && c == t) ? c : 0;
   else if(Mode == STRAT_CARRY_ONLY) d = c;
   else d = t;
   if(d < 0 && !AllowShort) d = 0;
   return(d);
  }

//+------------------------------------------------------------------+
//| 年間の振れ幅が口座の TargetVolPct% になるロット                    |
//+------------------------------------------------------------------+
double TargetLots()
  {
   double vol       = AnnualVol();
   double price     = iClose(NULL, PERIOD_D1, 1);
   double tickValue = MarketInfo(Symbol(), MODE_TICKVALUE);
   double tickSize  = MarketInfo(Symbol(), MODE_TICKSIZE);
   if(vol <= 0 || price <= 0 || tickValue <= 0 || tickSize <= 0) return(0);
   double riskPerLot = vol * price / tickSize * tickValue;   // 1ロットの年間の振れ幅（口座通貨）
   double lots = AccountEquity() * TargetVolPct / 100.0 / riskPerLot;
   double step = MarketInfo(Symbol(), MODE_LOTSTEP);
   double minL = MarketInfo(Symbol(), MODE_MINLOT);
   double maxL = MathMin(MaxLots, MarketInfo(Symbol(), MODE_MAXLOT));
   if(step > 0) lots = NormalizeDouble(MathFloor(lots / step + 1e-9) * step, 2);
   if(lots < minL) return(0);   // 口座が小さすぎて最小ロットでも振れ幅が大きすぎる
   return(MathMin(lots, maxL));
  }

//+------------------------------------------------------------------+
//| このEAの持ち高（向きと合計ロット）                                 |
//+------------------------------------------------------------------+
int CurrentPosition(double &lots)
  {
   lots = 0;
   int dir = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != Symbol() || OrderMagicNumber() != MagicNumber) continue;
      if(OrderType() == OP_BUY)  { dir = 1;  lots += OrderLots(); }
      if(OrderType() == OP_SELL) { dir = -1; lots += OrderLots(); }
     }
   return(dir);
  }

//+------------------------------------------------------------------+
bool CloseAll()
  {
   bool ok = true;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != Symbol() || OrderMagicNumber() != MagicNumber) continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
      RefreshRates();
      double px = (OrderType() == OP_BUY) ? Bid : Ask;
      if(!OrderClose(OrderTicket(), OrderLots(), px, SlippagePoints, clrGray))
        {
         Print("決済に失敗: ", GetLastError());
         ok = false;
        }
     }
   return(ok);
  }

//+------------------------------------------------------------------+
bool Open(int dir, double lots)
  {
   RefreshRates();
   double atr = iATR(NULL, PERIOD_D1, 20, 1);
   double sl = 0;
   double px = (dir > 0) ? Ask : Bid;
   if(StopATRMult > 0 && atr > 0)
     {
      double minDist = MarketInfo(Symbol(), MODE_STOPLEVEL) * Point;
      double dist = MathMax(StopATRMult * atr, minDist + 10 * Point);
      sl = NormalizeDouble(dir > 0 ? px - dist : px + dist, Digits);
     }
   int type = (dir > 0) ? OP_BUY : OP_SELL;
   int ticket = OrderSend(Symbol(), type, lots, px, SlippagePoints, sl, 0, "CarryTrend", MagicNumber, 0,
                          dir > 0 ? clrDodgerBlue : clrTomato);
   if(ticket < 0)
     {
      Print("発注に失敗: ", GetLastError());
      return(false);
     }
   return(true);
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   datetime today = iTime(NULL, PERIOD_D1, 0);
   if(today == g_doneDay) return;                     // 1日1回だけ判断する
   if(MarketInfo(Symbol(), MODE_SPREAD) > MaxSpreadPoints) return;  // 広いときは次のティックで再挑戦

   int    want   = DesiredDirection();
   double target = (want != 0) ? TargetLots() : 0;
   if(target <= 0) want = 0;
   double have = 0;
   int    dir  = CurrentPosition(have);

   bool ok = true;
   bool resize = (dir != 0 && dir == want && target > 0 && MathAbs(have - target) / target > ResizeBand);
   if(dir != want || resize)
     {
      if(dir != 0) ok = CloseAll();
      if(ok && want != 0) ok = Open(want, target);
     }
   if(ok) g_doneDay = today;

   Comment(StringFormat("CarryTrend  キャリー:%d  トレンド:%d  目標:%d  保有:%d (%.2f lot)  年率変動:%.1f%%",
                        CarryDirection(), TrendDirection(), want, CurrentPosition(have), have, AnnualVol() * 100));
  }
//+------------------------------------------------------------------+
