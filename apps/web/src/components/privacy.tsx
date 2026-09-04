"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "./ui/button";
import { HoverHint } from "./ui/tooltip";
import { PRIVACY_KEY, LEGACY_LAYOUT_KEY, privacyPreference } from "@/lib/privacy-preference";

const PrivacyContext = createContext({ enabled: true, ready: false, error: "", toggle: () => {} });
export const usePrivacy = () => useContext(PrivacyContext).enabled;

export function PrivacyProvider({ children }: { children: ReactNode }) {
  // Hide amounts until the saved preference has loaded, avoiding a flash on direct navigation.
  const [enabled, setEnabled] = useState(true),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const read = () => {
      try {
        const current = localStorage.getItem(PRIVACY_KEY);
        const saved = privacyPreference(current, localStorage.getItem(LEGACY_LAYOUT_KEY));
        setEnabled(saved);
        if (current === null) localStorage.setItem(PRIVACY_KEY, String(saved));
        setError("");
      } catch {
        setError("Could not read your privacy preference.");
      }
      setReady(true);
    };
    read();
    const sync = (event: StorageEvent) => {
      if (event.key === PRIVACY_KEY || event.key === LEGACY_LAYOUT_KEY || event.key === null)
        read();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try {
      localStorage.setItem(PRIVACY_KEY, String(next));
      setError("");
    } catch {
      setError("Privacy changed for this page, but could not be saved in this browser.");
    }
  };
  return (
    <PrivacyContext.Provider value={{ enabled, ready, error, toggle }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function PrivacyToggle({
  compact = false,
  iconOnly = false,
}: {
  compact?: boolean;
  iconOnly?: boolean;
}) {
  const { enabled, ready, error, toggle } = useContext(PrivacyContext);
  return (
    <div className={compact ? "relative shrink-0" : "space-y-2"}>
      <Button
        className={
          iconOnly
            ? "h-9 w-9 rounded-lg p-0"
            : compact
              ? "h-9 gap-1.5 rounded-xl px-2.5 text-xs"
              : "w-full justify-start gap-2"
        }
        size="sm"
        variant={enabled ? "secondary" : "outline"}
        aria-label={`Privacy mode ${enabled ? "on" : "off"}`}
        aria-pressed={enabled}
        disabled={!ready}
        onClick={toggle}
        title="Hide balances, P&L and trade prices across the journal"
      >
        {enabled ? <EyeOff /> : <Eye />}
        {!iconOnly && (compact ? "Privacy" : "Privacy mode")}
        {!iconOnly && <span className="ml-auto text-xs">{enabled ? "On" : "Off"}</span>}
      </Button>
      {error && (
        <p
          role="alert"
          className={
            compact
              ? "absolute right-0 top-full mt-2 w-64 rounded-lg border bg-card p-3 text-xs text-destructive shadow-lg"
              : "text-xs text-destructive"
          }
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function MonetaryValue({ children }: { children: ReactNode }) {
  return usePrivacy() ? <span aria-label="Monetary value hidden">••••</span> : children;
}

export function MonetaryField({
  children,
  sensitive = true,
}: {
  children: ReactNode;
  sensitive?: boolean;
}) {
  const enabled = usePrivacy();
  return enabled && sensitive ? (
    <HoverHint content="Turn off privacy mode to edit this value">
      <div
        className="flex h-9 items-center rounded-md border px-3 text-sm"
        aria-label="Monetary value hidden"
        tabIndex={0}
      >
        ••••
      </div>
    </HoverHint>
  ) : (
    children
  );
}
