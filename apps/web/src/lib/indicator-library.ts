/**
 * Built-in chart indicators, written in Pine Script v5 for the PineTS engine. They are
 * ordinary scripts: open one in the editor to see how it works or copy it as a start for
 * your own. Each exposes its lengths and levels as inputs, editable from the chart legend.
 */
export interface LibraryIndicator {
  key: string;
  name: string;
  category: "Trend" | "Volatility" | "Momentum" | "Volume" | "Signals";
  description: string;
  source: string;
}

export const INDICATOR_LIBRARY: LibraryIndicator[] = [
  {
    key: "sma",
    name: "Simple moving average",
    category: "Trend",
    description: "Average close over a lookback, drawn on price.",
    source: `//@version=5
indicator("SMA", overlay=true)
len = input.int(20, "Length", minval=1)
src = input.source(close, "Source")
plot(ta.sma(src, len), "SMA", color=color.orange, linewidth=2)`,
  },
  {
    key: "ema",
    name: "Exponential moving average",
    category: "Trend",
    description: "Moving average weighted toward recent candles.",
    source: `//@version=5
indicator("EMA", overlay=true)
len = input.int(21, "Length", minval=1)
src = input.source(close, "Source")
plot(ta.ema(src, len), "EMA", color=color.aqua, linewidth=2)`,
  },
  {
    key: "ema-ribbon",
    name: "EMA ribbon (9 / 21 / 50 / 200)",
    category: "Trend",
    description: "Four EMAs to read trend alignment at a glance.",
    source: `//@version=5
indicator("EMA ribbon", overlay=true)
plot(ta.ema(close, input.int(9, "Fast")), "EMA fast", color=color.new(color.aqua, 0))
plot(ta.ema(close, input.int(21, "Medium")), "EMA medium", color=color.new(color.blue, 0))
plot(ta.ema(close, input.int(50, "Slow")), "EMA slow", color=color.new(color.purple, 0))
plot(ta.ema(close, input.int(200, "Long")), "EMA long", color=color.new(color.gray, 0), linewidth=2)`,
  },
  {
    key: "vwap",
    name: "VWAP",
    category: "Volume",
    description: "Volume-weighted average price, resetting each session.",
    source: `//@version=5
indicator("VWAP", overlay=true)
plot(ta.vwap(hlc3), "VWAP", color=color.yellow, linewidth=2)`,
  },
  {
    key: "bollinger",
    name: "Bollinger Bands",
    category: "Volatility",
    description: "Moving average with bands at a number of standard deviations.",
    source: `//@version=5
indicator("Bollinger Bands", overlay=true)
len = input.int(20, "Length", minval=1)
mult = input.float(2.0, "Deviations", minval=0.1, step=0.1)
[basis, upper, lower] = ta.bb(close, len, mult)
plot(basis, "Basis", color=color.orange)
u = plot(upper, "Upper", color=color.blue)
l = plot(lower, "Lower", color=color.blue)
fill(u, l, color=color.new(color.blue, 92), title="Band")`,
  },
  {
    key: "donchian",
    name: "Donchian channel",
    category: "Volatility",
    description: "Highest high and lowest low over a lookback.",
    source: `//@version=5
indicator("Donchian channel", overlay=true)
len = input.int(20, "Length", minval=1)
hi = ta.highest(high, len)
lo = ta.lowest(low, len)
u = plot(hi, "Upper", color=color.teal)
l = plot(lo, "Lower", color=color.teal)
plot(math.avg(hi, lo), "Middle", color=color.new(color.teal, 50))
fill(u, l, color=color.new(color.teal, 94), title="Channel")`,
  },
  {
    key: "supertrend",
    name: "Supertrend",
    category: "Trend",
    description: "ATR trailing line that flips with the trend.",
    source: `//@version=5
indicator("Supertrend", overlay=true)
factor = input.float(3.0, "Factor", minval=0.1, step=0.1)
atrLen = input.int(10, "ATR length", minval=1)
[st, dir] = ta.supertrend(factor, atrLen)
plot(dir < 0 ? st : na, "Uptrend", color=color.green, linewidth=2, style=plot.style_linebr)
plot(dir > 0 ? st : na, "Downtrend", color=color.red, linewidth=2, style=plot.style_linebr)`,
  },
  {
    key: "atr",
    name: "Average true range",
    category: "Volatility",
    description: "Average candle range including gaps; sizes stops.",
    source: `//@version=5
indicator("ATR")
plot(ta.atr(input.int(14, "Length", minval=1)), "ATR", color=color.purple)`,
  },
  {
    key: "rsi",
    name: "Relative strength index",
    category: "Momentum",
    description: "Momentum oscillator from 0 to 100 with 70/30 levels.",
    source: `//@version=5
indicator("RSI")
len = input.int(14, "Length", minval=1)
ob = input.int(70, "Overbought")
os = input.int(30, "Oversold")
plot(ta.rsi(close, len), "RSI", color=color.purple, linewidth=2)
hline(ob, "Overbought", color=color.gray)
hline(50, "Middle", color=color.new(color.gray, 60))
hline(os, "Oversold", color=color.gray)`,
  },
  {
    key: "macd",
    name: "MACD",
    category: "Momentum",
    description: "Difference of two EMAs, its signal line and histogram.",
    source: `//@version=5
indicator("MACD")
fast = input.int(12, "Fast", minval=1)
slow = input.int(26, "Slow", minval=1)
sig = input.int(9, "Signal", minval=1)
[m, s, h] = ta.macd(close, fast, slow, sig)
plot(h, "Histogram", style=plot.style_columns, color=h >= 0 ? color.new(color.teal, 40) : color.new(color.red, 40))
plot(m, "MACD", color=color.blue)
plot(s, "Signal", color=color.orange)
hline(0, "Zero", color=color.gray)`,
  },
  {
    key: "stochastic",
    name: "Stochastic",
    category: "Momentum",
    description: "Close relative to its recent range, smoothed.",
    source: `//@version=5
indicator("Stochastic")
len = input.int(14, "%K length", minval=1)
smoothK = input.int(3, "%K smoothing", minval=1)
smoothD = input.int(3, "%D smoothing", minval=1)
k = ta.sma(ta.stoch(close, high, low, len), smoothK)
plot(k, "%K", color=color.blue)
plot(ta.sma(k, smoothD), "%D", color=color.orange)
hline(80, "Upper", color=color.gray)
hline(20, "Lower", color=color.gray)`,
  },
  {
    key: "adx",
    name: "ADX / DMI",
    category: "Trend",
    description: "Trend strength with the directional movement lines.",
    source: `//@version=5
indicator("ADX")
len = input.int(14, "DI length", minval=1)
smooth = input.int(14, "ADX smoothing", minval=1)
[plus, minus, adx] = ta.dmi(len, smooth)
plot(adx, "ADX", color=color.orange, linewidth=2)
plot(plus, "+DI", color=color.green)
plot(minus, "-DI", color=color.red)
hline(25, "Trend threshold", color=color.gray)`,
  },
  {
    key: "obv",
    name: "On-balance volume",
    category: "Volume",
    description: "Running volume total, added on up closes and subtracted on down closes.",
    source: `//@version=5
indicator("OBV")
plot(ta.obv, "OBV", color=color.teal)`,
  },
  {
    key: "wma",
    name: "Weighted moving average",
    category: "Trend",
    description: "Linear-weighted average; newer candles count more.",
    source: `//@version=5
indicator("WMA", overlay=true)
len = input.int(20, "Length", minval=1)
src = input.source(close, "Source")
plot(ta.wma(src, len), "WMA", color=color.teal, linewidth=2)`,
  },
  {
    key: "hma",
    name: "Hull moving average",
    category: "Trend",
    description: "Fast, smooth average with little lag; colour shows its slope.",
    source: `//@version=5
indicator("HMA", overlay=true)
len = input.int(55, "Length", minval=2)
src = input.source(close, "Source")
h = ta.hma(src, len)
plot(h, "HMA", color=h >= h[1] ? color.green : color.red, linewidth=2)`,
  },
  {
    key: "vwma",
    name: "Volume-weighted moving average",
    category: "Trend",
    description: "Average close weighted by each candle's volume.",
    source: `//@version=5
indicator("VWMA", overlay=true)
len = input.int(20, "Length", minval=1)
plot(ta.vwma(close, len), "VWMA", color=color.fuchsia, linewidth=2)`,
  },
  {
    key: "alma",
    name: "Arnaud Legoux moving average",
    category: "Trend",
    description: "Gaussian-weighted average that balances smoothness and lag.",
    source: `//@version=5
indicator("ALMA", overlay=true)
len = input.int(21, "Length", minval=1)
offset = input.float(0.85, "Offset", step=0.05)
sigma = input.float(6, "Sigma", step=0.5)
plot(ta.alma(close, len, offset, sigma), "ALMA", color=color.lime, linewidth=2)`,
  },
  {
    key: "sma-pair",
    name: "Moving averages 50 / 200",
    category: "Trend",
    description: "The classic 50 and 200 period SMAs for the long-term trend.",
    source: `//@version=5
indicator("SMA 50 / 200", overlay=true)
plot(ta.sma(close, input.int(50, "Fast", minval=1)), "SMA fast", color=color.orange, linewidth=2)
plot(ta.sma(close, input.int(200, "Slow", minval=1)), "SMA slow", color=color.blue, linewidth=2)`,
  },
  {
    key: "psar",
    name: "Parabolic SAR",
    category: "Trend",
    description: "Trailing dots that flip sides when the trend reverses.",
    source: `//@version=5
indicator("Parabolic SAR", overlay=true)
start = input.float(0.02, "Start", step=0.01)
inc = input.float(0.02, "Increment", step=0.01)
maxAf = input.float(0.2, "Maximum", step=0.01)
s = ta.sar(start, inc, maxAf)
plot(s, "SAR", style=plot.style_circles, color=s < close ? color.green : color.red, linewidth=2)`,
  },
  {
    key: "ichimoku",
    name: "Ichimoku cloud",
    category: "Trend",
    description: "Conversion and base lines with the cloud under the current candles.",
    source: `//@version=5
indicator("Ichimoku", overlay=true)
convLen = input.int(9, "Conversion line", minval=1)
baseLen = input.int(26, "Base line", minval=1)
spanBLen = input.int(52, "Leading span B", minval=1)
shift = input.int(26, "Displacement", minval=1)
mid(len) => math.avg(ta.lowest(low, len), ta.highest(high, len))
conv = mid(convLen)
base = mid(baseLen)
// The cloud as it stands under each candle: spans computed one displacement earlier.
spanA = math.avg(conv[shift - 1], base[shift - 1])
spanB = mid(spanBLen)[shift - 1]
plot(conv, "Conversion", color=color.blue)
plot(base, "Base", color=color.maroon)
a = plot(spanA, "Leading span A", color=color.new(color.green, 40))
b = plot(spanB, "Leading span B", color=color.new(color.red, 40))
fill(a, b, color=spanA > spanB ? color.new(color.green, 85) : color.new(color.red, 85), title="Cloud")`,
  },
  {
    key: "linreg",
    name: "Linear regression channel",
    category: "Trend",
    description: "Least-squares trend line with bands two deviations away.",
    source: `//@version=5
indicator("Linear regression", overlay=true)
len = input.int(100, "Length", minval=2)
mult = input.float(2, "Deviations", step=0.5)
mid = ta.linreg(close, len, 0)
dev = ta.stdev(close, len)
plot(mid, "Regression", color=color.orange, linewidth=2)
plot(mid + mult * dev, "Upper", color=color.new(color.orange, 50))
plot(mid - mult * dev, "Lower", color=color.new(color.orange, 50))`,
  },
  {
    key: "aroon",
    name: "Aroon",
    category: "Trend",
    description: "How recently the highest high and lowest low happened, from 0 to 100.",
    source: `//@version=5
indicator("Aroon")
len = input.int(14, "Length", minval=1)
up = 100 * (ta.highestbars(high, len + 1) + len) / len
down = 100 * (ta.lowestbars(low, len + 1) + len) / len
plot(up, "Aroon up", color=color.green)
plot(down, "Aroon down", color=color.red)
hline(70, "Strong", color=color.gray)
hline(30, "Weak", color=color.gray)`,
  },
  {
    key: "keltner",
    name: "Keltner channel",
    category: "Volatility",
    description: "EMA with bands a multiple of the average range away.",
    source: `//@version=5
indicator("Keltner channel", overlay=true)
len = input.int(20, "Length", minval=1)
mult = input.float(2, "Multiplier", step=0.5)
[mid, upper, lower] = ta.kc(close, len, mult)
plot(mid, "Basis", color=color.orange)
u = plot(upper, "Upper", color=color.teal)
l = plot(lower, "Lower", color=color.teal)
fill(u, l, color=color.new(color.teal, 92), title="Channel")`,
  },
  {
    key: "bb-width",
    name: "Bollinger bandwidth",
    category: "Volatility",
    description: "Width of the Bollinger Bands; low values flag a squeeze.",
    source: `//@version=5
indicator("Bollinger bandwidth")
len = input.int(20, "Length", minval=1)
mult = input.float(2, "Deviations", step=0.5)
plot(ta.bbw(close, len, mult), "Bandwidth", color=color.blue)`,
  },
  {
    key: "stdev",
    name: "Standard deviation",
    category: "Volatility",
    description: "How far closes spread around their average.",
    source: `//@version=5
indicator("Standard deviation")
len = input.int(20, "Length", minval=1)
plot(ta.stdev(close, len), "StdDev", color=color.purple)`,
  },
  {
    key: "hist-vol",
    name: "Historical volatility",
    category: "Volatility",
    description: "Annualised deviation of log returns, in percent.",
    source: `//@version=5
indicator("Historical volatility")
len = input.int(20, "Length", minval=2)
perYear = input.int(365, "Candles per year", minval=1)
ret = math.log(close / close[1])
plot(100 * ta.stdev(ret, len) * math.sqrt(perYear), "HV %", color=color.orange)`,
  },
  {
    key: "chandelier",
    name: "Chandelier exit",
    category: "Volatility",
    description: "ATR trailing stops from the recent high and low.",
    source: `//@version=5
indicator("Chandelier exit", overlay=true)
len = input.int(22, "Length", minval=1)
mult = input.float(3, "ATR multiplier", step=0.5)
a = ta.atr(len) * mult
plot(ta.highest(high, len) - a, "Long stop", color=color.green)
plot(ta.lowest(low, len) + a, "Short stop", color=color.red)`,
  },
  {
    key: "stoch-rsi",
    name: "Stochastic RSI",
    category: "Momentum",
    description: "Stochastic applied to RSI; faster turns at the extremes.",
    source: `//@version=5
indicator("Stochastic RSI")
rsiLen = input.int(14, "RSI length", minval=1)
stochLen = input.int(14, "Stochastic length", minval=1)
smoothK = input.int(3, "K", minval=1)
smoothD = input.int(3, "D", minval=1)
r = ta.rsi(close, rsiLen)
k = ta.sma(ta.stoch(r, r, r, stochLen), smoothK)
plot(k, "K", color=color.blue)
plot(ta.sma(k, smoothD), "D", color=color.orange)
hline(80, "Upper", color=color.gray)
hline(20, "Lower", color=color.gray)`,
  },
  {
    key: "cci",
    name: "Commodity channel index",
    category: "Momentum",
    description: "Distance from the average typical price, with ±100 levels.",
    source: `//@version=5
indicator("CCI")
len = input.int(20, "Length", minval=1)
plot(ta.cci(hlc3, len), "CCI", color=color.teal)
hline(100, "Upper", color=color.gray)
hline(0, "Zero", color=color.new(color.gray, 60))
hline(-100, "Lower", color=color.gray)`,
  },
  {
    key: "williams-r",
    name: "Williams %R",
    category: "Momentum",
    description: "Close within the recent range, from 0 to -100.",
    source: `//@version=5
indicator("Williams %R")
len = input.int(14, "Length", minval=1)
plot(ta.wpr(len), "%R", color=color.purple)
hline(-20, "Overbought", color=color.gray)
hline(-80, "Oversold", color=color.gray)`,
  },
  {
    key: "momentum",
    name: "Momentum",
    category: "Momentum",
    description: "Close minus the close a number of candles ago.",
    source: `//@version=5
indicator("Momentum")
len = input.int(10, "Length", minval=1)
plot(ta.mom(close, len), "Momentum", color=color.blue)
hline(0, "Zero", color=color.gray)`,
  },
  {
    key: "roc",
    name: "Rate of change",
    category: "Momentum",
    description: "Percent change over a number of candles.",
    source: `//@version=5
indicator("ROC")
len = input.int(9, "Length", minval=1)
plot(ta.roc(close, len), "ROC", color=color.blue)
hline(0, "Zero", color=color.gray)`,
  },
  {
    key: "tsi",
    name: "True strength index",
    category: "Momentum",
    description: "Double-smoothed momentum with a signal line.",
    source: `//@version=5
indicator("TSI")
longLen = input.int(25, "Long length", minval=1)
shortLen = input.int(13, "Short length", minval=1)
sigLen = input.int(13, "Signal length", minval=1)
t = 100 * ta.tsi(close, shortLen, longLen)
plot(t, "TSI", color=color.blue)
plot(ta.ema(t, sigLen), "Signal", color=color.orange)
hline(0, "Zero", color=color.gray)`,
  },
  {
    key: "cmo",
    name: "Chande momentum oscillator",
    category: "Momentum",
    description: "Up moves minus down moves over their sum, from -100 to 100.",
    source: `//@version=5
indicator("CMO")
len = input.int(9, "Length", minval=1)
plot(ta.cmo(close, len), "CMO", color=color.teal)
hline(50, "Upper", color=color.gray)
hline(-50, "Lower", color=color.gray)`,
  },
  {
    key: "awesome",
    name: "Awesome oscillator",
    category: "Momentum",
    description: "5 minus 34 period average of the candle midpoint, as columns.",
    source: `//@version=5
indicator("Awesome oscillator")
ao = ta.sma(hl2, input.int(5, "Fast", minval=1)) - ta.sma(hl2, input.int(34, "Slow", minval=1))
plot(ao, "AO", style=plot.style_columns, color=ao >= ao[1] ? color.new(color.teal, 30) : color.new(color.red, 30))`,
  },
  {
    key: "volume-ma",
    name: "Volume with average",
    category: "Volume",
    description: "Volume columns by candle direction and their moving average.",
    source: `//@version=5
indicator("Volume")
len = input.int(20, "Average length", minval=1)
plot(volume, "Volume", style=plot.style_columns, color=close >= open ? color.new(color.teal, 50) : color.new(color.red, 50))
plot(ta.sma(volume, len), "Average", color=color.orange)`,
  },
  {
    key: "mfi",
    name: "Money flow index",
    category: "Volume",
    description: "Volume-weighted RSI from 0 to 100 with 80/20 levels.",
    source: `//@version=5
indicator("MFI")
len = input.int(14, "Length", minval=1)
plot(ta.mfi(hlc3, len), "MFI", color=color.purple)
hline(80, "Overbought", color=color.gray)
hline(20, "Oversold", color=color.gray)`,
  },
  {
    key: "cmf",
    name: "Chaikin money flow",
    category: "Volume",
    description: "Buying or selling pressure: where closes sit in the range, times volume.",
    source: `//@version=5
indicator("CMF")
len = input.int(20, "Length", minval=1)
mfv = high == low ? 0 : ((close - low) - (high - close)) / (high - low) * volume
cmf = math.sum(mfv, len) / math.sum(volume, len)
plot(cmf, "CMF", color=cmf >= 0 ? color.green : color.red)
hline(0, "Zero", color=color.gray)`,
  },
  {
    key: "accdist",
    name: "Accumulation / distribution",
    category: "Volume",
    description: "Running total of volume weighted by where each close sits in its range.",
    source: `//@version=5
indicator("Accumulation / distribution")
plot(ta.accdist, "A/D", color=color.teal)`,
  },
  {
    key: "pvt",
    name: "Price-volume trend",
    category: "Volume",
    description: "Running total of volume times the percent change.",
    source: `//@version=5
indicator("PVT")
plot(ta.pvt, "PVT", color=color.blue)`,
  },
  {
    key: "ema-cross",
    name: "EMA cross signals",
    category: "Signals",
    description: "Marks and alerts when a fast EMA crosses a slow one.",
    source: `//@version=5
indicator("EMA cross signals", overlay=true)
fastLen = input.int(9, "Fast EMA", minval=1)
slowLen = input.int(21, "Slow EMA", minval=1)
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
plot(fast, "Fast", color=color.aqua)
plot(slow, "Slow", color=color.orange)
bull = ta.crossover(fast, slow)
bear = ta.crossunder(fast, slow)
plotshape(bull, "Bullish cross", shape.triangleup, location.belowbar, color.green, size=size.small)
plotshape(bear, "Bearish cross", shape.triangledown, location.abovebar, color.red, size=size.small)
if bull
    alert("Fast EMA crossed above the slow EMA", alert.freq_once_per_bar_close)
if bear
    alert("Fast EMA crossed below the slow EMA", alert.freq_once_per_bar_close)`,
  },
  {
    key: "rsi-extremes",
    name: "RSI extremes",
    category: "Signals",
    description: "Highlights candles where RSI leaves its overbought or oversold zone.",
    source: `//@version=5
indicator("RSI extremes", overlay=true)
len = input.int(14, "RSI length", minval=1)
ob = input.int(70, "Overbought")
os = input.int(30, "Oversold")
r = ta.rsi(close, len)
exitOb = ta.crossunder(r, ob)
exitOs = ta.crossover(r, os)
plotshape(exitOs, "Leaves oversold", shape.labelup, location.belowbar, color.new(color.green, 20), text="RSI")
plotshape(exitOb, "Leaves overbought", shape.labeldown, location.abovebar, color.new(color.red, 20), text="RSI")
if exitOs
    alert("RSI left the oversold zone", alert.freq_once_per_bar_close)
if exitOb
    alert("RSI left the overbought zone", alert.freq_once_per_bar_close)`,
  },
  {
    key: "golden-cross",
    name: "Golden and death cross",
    category: "Signals",
    description: "Marks and alerts when the 50 SMA crosses the 200 SMA.",
    source: `//@version=5
indicator("Golden / death cross", overlay=true)
fast = ta.sma(close, input.int(50, "Fast SMA", minval=1))
slow = ta.sma(close, input.int(200, "Slow SMA", minval=1))
plot(fast, "Fast", color=color.orange)
plot(slow, "Slow", color=color.blue)
golden = ta.crossover(fast, slow)
death = ta.crossunder(fast, slow)
plotshape(golden, "Golden cross", shape.triangleup, location.belowbar, color.green, size=size.small)
plotshape(death, "Death cross", shape.triangledown, location.abovebar, color.red, size=size.small)
if golden
    alert("Golden cross: the fast SMA crossed above the slow SMA", alert.freq_once_per_bar_close)
if death
    alert("Death cross: the fast SMA crossed below the slow SMA", alert.freq_once_per_bar_close)`,
  },
  {
    key: "macd-cross",
    name: "MACD cross signals",
    category: "Signals",
    description: "Marks and alerts when MACD crosses its signal line.",
    source: `//@version=5
indicator("MACD cross signals", overlay=true)
[m, s, h] = ta.macd(close, input.int(12, "Fast", minval=1), input.int(26, "Slow", minval=1), input.int(9, "Signal", minval=1))
up = ta.crossover(m, s)
down = ta.crossunder(m, s)
plotshape(up, "MACD crosses up", shape.triangleup, location.belowbar, color.green, size=size.small)
plotshape(down, "MACD crosses down", shape.triangledown, location.abovebar, color.red, size=size.small)
if up
    alert("MACD crossed above its signal line", alert.freq_once_per_bar_close)
if down
    alert("MACD crossed below its signal line", alert.freq_once_per_bar_close)`,
  },
  {
    key: "bb-breakout",
    name: "Bollinger breakouts",
    category: "Signals",
    description: "Marks and alerts when a close breaks outside the bands.",
    source: `//@version=5
indicator("Bollinger breakouts", overlay=true)
len = input.int(20, "Length", minval=1)
mult = input.float(2, "Deviations", step=0.5)
[mid, upper, lower] = ta.bb(close, len, mult)
plot(upper, "Upper", color=color.new(color.blue, 50))
plot(lower, "Lower", color=color.new(color.blue, 50))
above = ta.crossover(close, upper)
below = ta.crossunder(close, lower)
plotshape(above, "Close above the upper band", shape.circle, location.abovebar, color.green, size=size.tiny)
plotshape(below, "Close below the lower band", shape.circle, location.belowbar, color.red, size=size.tiny)
if above
    alert("Close broke above the upper Bollinger Band", alert.freq_once_per_bar_close)
if below
    alert("Close broke below the lower Bollinger Band", alert.freq_once_per_bar_close)`,
  },
  {
    key: "supertrend-flip",
    name: "Supertrend flips",
    category: "Signals",
    description: "Marks and alerts when the Supertrend changes direction.",
    source: `//@version=5
indicator("Supertrend flips", overlay=true)
[st, dir] = ta.supertrend(input.float(3, "Factor", step=0.5), input.int(10, "ATR length", minval=1))
plot(st, "Supertrend", color=dir < 0 ? color.green : color.red)
up = dir < 0 and dir[1] > 0
down = dir > 0 and dir[1] < 0
plotshape(up, "Turns up", shape.labelup, location.belowbar, color.new(color.green, 20), text="Up")
plotshape(down, "Turns down", shape.labeldown, location.abovebar, color.new(color.red, 20), text="Down")
if up
    alert("Supertrend turned up", alert.freq_once_per_bar_close)
if down
    alert("Supertrend turned down", alert.freq_once_per_bar_close)`,
  },
  {
    key: "swing-points",
    name: "Swing highs and lows",
    category: "Signals",
    description: "Marks a swing high or low once enough candles on its right confirm it.",
    source: `//@version=5
indicator("Swing highs and lows", overlay=true)
left = input.int(5, "Candles on the left", minval=1)
right = input.int(5, "Candles on the right", minval=1)
ph = ta.pivothigh(high, left, right)
pl = ta.pivotlow(low, left, right)
// Shown on the candle that confirms the swing, 'right' candles after it.
plotshape(not na(ph), "Swing high confirmed", shape.xcross, location.abovebar, color.red, size=size.tiny)
plotshape(not na(pl), "Swing low confirmed", shape.xcross, location.belowbar, color.green, size=size.tiny)
if not na(ph)
    alert("Swing high confirmed", alert.freq_once_per_bar_close)
if not na(pl)
    alert("Swing low confirmed", alert.freq_once_per_bar_close)`,
  },
];

export const libraryIndicator = (key: string) => INDICATOR_LIBRARY.find((i) => i.key === key);

/** A starting point for a new custom indicator. */
export const NEW_INDICATOR_TEMPLATE = `//@version=5
indicator("My indicator", overlay=true)

length = input.int(20, "Length", minval=1)
basis = ta.sma(close, length)

plot(basis, "Basis", color=color.orange, linewidth=2)

// Signals: shapes on the chart, alerts in the Line alerts panel.
crossUp = ta.crossover(close, basis)
plotshape(crossUp, "Close above basis", shape.triangleup, location.belowbar, color.green)
if crossUp
    alert("Close crossed above the basis", alert.freq_once_per_bar_close)
`;
