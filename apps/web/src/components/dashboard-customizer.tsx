"use client";

import { forwardRef, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useTranslations } from "next-intl";
import {
  Activity,
  ArrowUpDown,
  CalendarCheck,
  CalendarDays,
  ChartColumn,
  ChartLine,
  ChevronDown,
  Clock3,
  Flame,
  Gauge,
  Percent,
  RotateCcw,
  Scale,
  Search,
  SearchX,
  Settings2,
  Target,
  Timer,
  TrendingDown,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface CardOption {
  id: string;
  label: string;
}

interface DashboardCustomizerProps {
  widgets: CardOption[];
  hidden: string[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onVisibilityChange(id: string, visible: boolean): void;
  onShowAll(): void;
  onRestore(): void;
}

// Decorative only: a new card remains available even without a dedicated icon.
// Keyed by the stable widget id, not the (translated) label.
const cardIcons: Record<string, LucideIcon> = {
  "widget-0": Wallet,
  "widget-1": Percent,
  "widget-2": Scale,
  "widget-3": CalendarCheck,
  "widget-4": ArrowUpDown,
  "widget-5": Gauge,
  "widget-6": ChartLine,
  "widget-7": ChartColumn,
  "widget-8": CalendarDays,
  "widget-9": Activity,
  "widget-10": TrendingDown,
  "widget-11": Flame,
  "widget-12": Target,
  "widget-13": Timer,
  "widget-14": CalendarCheck,
  "widget-15": Clock3,
};

export function DashboardCustomizer(props: DashboardCustomizerProps) {
  const t = useTranslations("dashboard");
  return (
    <Popover.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Popover.Trigger asChild>
        <Button type="button" variant="outline" size="sm" className="dashboard-customize-trigger">
          <Settings2 />
          {t("customizer.trigger")}
          <ChevronDown className="dashboard-customize-chevron" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <CustomizerPanel {...props} />
      </Popover.Portal>
    </Popover.Root>
  );
}

const CustomizerPanel = forwardRef<HTMLDivElement, DashboardCustomizerProps>(
  function CustomizerPanel(
    { widgets, hidden, onVisibilityChange, onShowAll, onRestore },
    forwardedRef,
  ) {
    const t = useTranslations("dashboard");
    const titleId = useId();
    const [query, setQuery] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [listHeight, setListHeight] = useState<number>();
    const [highlight, setHighlight] = useState<{ top: number; height: number } | null>(null);
    const matches = widgets.filter((widget) =>
      widget.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    );

    useLayoutEffect(() => {
      const list = listRef.current;
      if (!list) return;
      const measure = () => setListHeight(Math.min(352, list.offsetHeight));
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(list);
      return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
      setHighlight(null);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [query]);

    function spotlight(button: HTMLButtonElement) {
      setHighlight({ top: button.offsetTop, height: button.offsetHeight });
    }

    function focusResult(index: number) {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-card-toggle]");
      if (!buttons?.length) return;
      const button = buttons[(index + buttons.length) % buttons.length];
      button?.focus({ preventScroll: true });
      button?.scrollIntoView({ block: "nearest" });
    }

    return (
      <Popover.Content
        ref={forwardedRef}
        align="end"
        sideOffset={10}
        collisionPadding={12}
        className="dashboard-customize-panel"
        aria-labelledby={titleId}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus({ preventScroll: true });
        }}
        onInteractOutside={(event) => {
          // Keep the existing move arrows usable while this non-modal panel is open.
          if (
            event.target instanceof Element &&
            event.target.closest("[data-dashboard-move-controls]")
          )
            event.preventDefault();
        }}
      >
        <div className="dashboard-customize-heading">
          <h2 id={titleId}>{t("customizer.title")}</h2>
          <span className="dashboard-customize-count">
            {t("customizer.visibleCount", { count: widgets.length - hidden.length })}
          </span>
          <Popover.Close asChild>
            <button
              type="button"
              className="dashboard-customize-icon-button"
              aria-label={t("customizer.close")}
            >
              <X size={14} />
            </button>
          </Popover.Close>
        </div>
        <div className="dashboard-customize-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            aria-label={t("customizer.searchLabel")}
            placeholder={t("customizer.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                focusResult(event.key === "ArrowDown" ? 0 : -1);
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="dashboard-customize-icon-button"
              aria-label={t("customizer.clearSearch")}
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>
        <div
          ref={scrollRef}
          className="dashboard-customize-results"
          style={{ height: listHeight }}
          onPointerLeave={() => {
            const focused = listRef.current?.querySelector<HTMLButtonElement>(
              "[data-card-toggle]:focus",
            );
            if (focused) spotlight(focused);
            else setHighlight(null);
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setHighlight(null);
          }}
          onKeyDown={(event) => {
            const buttons = Array.from(
              listRef.current?.querySelectorAll<HTMLButtonElement>("[data-card-toggle]") ?? [],
            );
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            const next = {
              ArrowDown: index + 1,
              ArrowUp: index - 1,
              Home: 0,
              End: buttons.length - 1,
            }[event.key];
            if (next !== undefined) {
              event.preventDefault();
              focusResult(next);
            }
          }}
        >
          <div ref={listRef} className="dashboard-customize-list">
            <div
              aria-hidden="true"
              className="dashboard-customize-highlight"
              style={{
                opacity: highlight ? 1 : 0,
                height: highlight?.height ?? 46,
                transform: `translateY(${highlight?.top ?? 4}px)`,
              }}
            />
            {matches.map((widget, index) => {
              const visible = !hidden.includes(widget.id);
              const Icon = cardIcons[widget.id] ?? Gauge;
              return (
                <button
                  key={widget.id}
                  type="button"
                  role="switch"
                  aria-checked={visible}
                  aria-label={t("customizer.showCard", { card: widget.label })}
                  data-card-toggle
                  className="dashboard-customize-option"
                  style={{ "--option-index": Math.min(index, 7) } as CSSProperties}
                  onPointerEnter={(event) => spotlight(event.currentTarget)}
                  onFocus={(event) => spotlight(event.currentTarget)}
                  onClick={() => onVisibilityChange(widget.id, !visible)}
                >
                  <span className="dashboard-customize-card-icon" aria-hidden="true">
                    <Icon size={15} strokeWidth={1.7} />
                  </span>
                  <span className="dashboard-customize-label">{widget.label}</span>
                  <span className="dashboard-customize-switch" aria-hidden="true">
                    <span />
                  </span>
                </button>
              );
            })}
            {matches.length === 0 && (
              <div className="dashboard-customize-empty">
                <SearchX size={22} aria-hidden="true" />
                <p>{t("customizer.noMatches")}</p>
                <button type="button" onClick={() => setQuery("")}>
                  {t("customizer.clearSearchAction")}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="dashboard-customize-footer">
          <button type="button" onClick={onRestore} aria-label={t("customizer.resetAria")}>
            <RotateCcw size={13} aria-hidden="true" />
            {t("customizer.reset")}
          </button>
          <button type="button" onClick={onShowAll} disabled={hidden.length === 0}>
            {t("customizer.showAll")}
          </button>
        </div>
        <span role="status" className="sr-only">
          {t("customizer.srStatus", {
            count: matches.length,
            visible: widgets.length - hidden.length,
            total: widgets.length,
          })}
        </span>
      </Popover.Content>
    );
  },
);
