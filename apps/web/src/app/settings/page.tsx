"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ChartCandlestick,
  Database,
  Download,
  Globe,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { JournalDefaultSettings } from "@/components/journal-default-settings";
import { ContractMultiplierSettings, TimeZoneSettings } from "@/components/journal-settings";
import { MarketDataSettings } from "@/components/market-data-settings";
import { AiSettings } from "@/components/ai-settings";
import { CurrencySettings } from "@/components/currency-settings";
import { FilterBar } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { cn } from "@/lib/utils";

const sections = [
  {
    id: "general",
    label: "General",
    icon: Globe,
    description: "Choose the timezones used to display and import your trades.",
  },
  {
    id: "trading",
    label: "Trading",
    icon: SlidersHorizontal,
    description: "Manage contract multipliers, breakeven rules, fees, and risk defaults.",
  },
  {
    id: "currency-conversion",
    label: "Currency conversion",
    icon: ArrowLeftRight,
    description: "Set a reporting currency and saved exchange rates for combined performance.",
  },
  {
    id: "market-data",
    label: "Market data",
    icon: ChartCandlestick,
    description: "Connect price history or upload candles for replay and trade analysis.",
  },
  {
    id: "ai-settings",
    label: "AI",
    icon: Sparkles,
    description: "Choose your AI provider and manage your model and API key.",
  },
  {
    id: "your-data",
    label: "Data & backups",
    icon: Database,
    description: "Download your journal data for safekeeping or use in other tools.",
  },
] as const;
type Section = (typeof sections)[number]["id"];

function sectionForHash(hash: string): Section {
  const id = hash.replace(/^#/, "");
  if (id === "market-csv") return "market-data";
  if (id === "contract-multipliers" || id === "journal-defaults") return "trading";
  return sections.find((section) => section.id === id)?.id ?? "general";
}

export default function SettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const [active, setActive] = useState<Section>("general");
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const restore = () => setActive(sectionForHash(window.location.hash));
    restore();
    window.addEventListener("hashchange", restore);
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("hashchange", restore);
      window.removeEventListener("popstate", restore);
    };
  }, []);

  const openSection = (section: Section) => {
    if (window.location.hash !== `#${section}`)
      window.history.pushState(window.history.state, "", `#${section}`);
    setActive(section);
    top.current?.scrollIntoView({ block: "start" });
  };

  return (
    <div>
      <FilterBar title="Settings" />
      <div
        ref={top}
        className="mx-auto grid max-w-5xl scroll-mt-20 gap-6 p-4 sm:p-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8"
      >
        <nav
          aria-label="Settings sections"
          className="hidden space-y-1 lg:sticky lg:top-20 lg:block lg:self-start"
        >
          {sections.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active === id ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active === id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                openSection(id);
              }}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {label}
            </a>
          ))}
        </nav>
        <div className="space-y-2 lg:hidden">
          <Label htmlFor="settings-section" className="text-xs text-muted-foreground">
            Settings section
          </Label>
          <OptionSelect
            id="settings-section"
            value={active}
            onValueChange={(value) => openSection(value as Section)}
          >
            {sections.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </OptionSelect>
        </div>
        <div className="min-w-0">
          {sections.map(({ id, label, description }) => (
            // Keep panels mounted so changing sections preserves unsaved form drafts.
            <section key={id} hidden={active !== id} aria-labelledby={`settings-heading-${id}`}>
              <div className="mb-5 space-y-1.5">
                <h2 id={`settings-heading-${id}`} className="text-xl font-semibold tracking-tight">
                  {label}
                </h2>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
              <div className="space-y-4">
                {id === "general" && <TimeZoneSettings />}
                {id === "trading" && (
                  <>
                    <ContractMultiplierSettings />
                    <JournalDefaultSettings />
                  </>
                )}
                {id === "currency-conversion" && <CurrencySettings />}
                {id === "market-data" && <MarketDataSettings />}
                {id === "ai-settings" && <AiSettings />}
                {id === "your-data" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Export your data</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Save a full journal backup, or export your trades as a CSV.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" asChild>
                          <a href="/api/export" download="trade-journal-export.json">
                            <Download aria-hidden="true" />
                            Full backup (JSON)
                          </a>
                        </Button>
                        <Button variant="outline" asChild>
                          <a href="/api/export?format=csv" download>
                            <Download aria-hidden="true" />
                            Trades (CSV)
                          </a>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
