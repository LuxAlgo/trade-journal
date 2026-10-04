import { bad, handler, ok, requireValue } from "@/server/api";
import { csvDatasets, importCsvDataset, removeCsvDataset } from "@/server/market-data/csv";
import { MAX_CSV_BYTES, parseMarketCsv } from "@/lib/market-csv";
import { isResolution, RESOLUTIONS, type Resolution } from "@/lib/market-data";
export const GET = handler(() => ok({ datasets: csvDatasets() }));
export const POST = handler(async (request: Request) => {
  const reader = request.body?.getReader();
  requireValue(reader, "Provide a market CSV request.");
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_CSV_BYTES * 2) {
      await reader.cancel();
      return bad("Use a CSV smaller than 5 MB.", 413, "csv_too_large");
    }
    parts.push(value);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    return bad("Invalid CSV request.");
  }
  requireValue(
    body && ["preview", "import", "remove"].includes(body.action),
    "Choose a CSV action.",
  );
  if (body.action === "remove") {
    requireValue(typeof body.id === "string" && body.id.length <= 80, "Choose a dataset.");
    removeCsvDataset(body.id);
    return ok({ datasets: csvDatasets() });
  }
  requireValue(typeof body.content === "string", "Choose a CSV file.");
  requireValue(
    typeof body.name === "string" && body.name.trim().length > 0 && body.name.length <= 200,
    "Enter a file name.",
  );
  requireValue(
    typeof body.symbol === "string" && /^[A-Za-z0-9._:/-]{1,100}$/.test(body.symbol),
    "Enter the exact instrument symbol.",
  );
  requireValue(isResolution(body.resolution), "Choose a candle resolution.");
  requireValue(
    typeof body.currency === "string" && /^[A-Z0-9]{2,12}$/.test(body.currency),
    "Enter the quote currency, such as USD or USDT.",
  );
  requireValue(
    ["raw", "split", "adjusted", "midpoint", "bid", "ask"].includes(body.priceBasis),
    "Choose the file's price basis.",
  );
  try {
    if (body.action === "import")
      return ok({ id: importCsvDataset(body), datasets: csvDatasets() });
    const bars = parseMarketCsv(body.content, body.symbol, body.resolution);
    return ok({
      count: bars.length,
      from: new Date(bars[0]!.time).toISOString(),
      to: new Date(bars.at(-1)!.time + RESOLUTIONS[body.resolution as Resolution]).toISOString(),
      sample: bars.slice(0, 3),
    });
  } catch (error) {
    // Third-party/parse failures: sanitized message plus a stable generic code.
    return bad(
      error instanceof Error ? error.message : "Invalid candle CSV.",
      400,
      "invalid_market_csv",
    );
  }
});
