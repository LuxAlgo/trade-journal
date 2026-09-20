import { headerKey } from "./csv";
import type { AssetClass } from "@luxalgo/journal-core";

/** IBKR Asset Category / AssetClass labels → journal asset class. */
export const ibkrAssetClass = (raw?: string): AssetClass | undefined => {
  if (!raw) return undefined;
  const mapped: Record<string, AssetClass> = {
    stk: "equity",
    stock: "equity",
    stocks: "equity",
    opt: "option",
    option: "option",
    options: "option",
    equityandindexoptions: "option",
    fop: "option",
    futuresoptions: "option",
    fut: "futures",
    futures: "futures",
    cash: "forex",
    forex: "forex",
    crypto: "crypto",
    cryptocurrency: "crypto",
    cfd: "cfd",
    cfds: "cfd",
  };
  return mapped[headerKey(raw)];
};
