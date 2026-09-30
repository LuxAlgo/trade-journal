"use client";
import { useEffect, useState } from "react";
import { currencyCodes, currencyName } from "@/lib/currencies";

export function CurrencyPicker({
  id,
  value,
  onChange,
  disabled = false,
  extraCodes = [],
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  extraCodes?: string[];
}) {
  // Node and the browser can ship different ICU currency lists and names.
  // Keep the first render identical, then populate the browser's catalogue.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const codes = [...new Set([...(ready ? currencyCodes : []), ...extraCodes, value])].sort();
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || !ready}
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
    >
      {codes.map((code) => (
        <option key={code} value={code}>
          {ready ? currencyName(code) : code}
        </option>
      ))}
    </select>
  );
}
