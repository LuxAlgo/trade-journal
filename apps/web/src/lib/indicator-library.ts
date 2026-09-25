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
