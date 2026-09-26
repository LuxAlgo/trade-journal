"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Which page sections you folded away (chart sidebar cards, the economic calendar block),
 * remembered per browser. Everything starts expanded.
 */
const KEY = "journal-collapsed-sections-v1";
const EVENT = "journal-collapsed-sections";
const MAX = 100;
const ID = /^[a-z0-9-]{1,60}$/;

/** Stored ids, keeping only well-formed ones. */
export function parseCollapsed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(value.filter((v): v is string => typeof v === "string" && ID.test(v))),
    ].slice(0, MAX);
  } catch {
    return [];
  }
}

/** The list with this section folded or unfolded. */
export function setCollapsed(list: string[], id: string, collapsed: boolean): string[] {
  const rest = list.filter((v) => v !== id);
  return collapsed ? [...rest, id].slice(-MAX) : rest;
}

const read = () => {
  try {
    return parseCollapsed(localStorage.getItem(KEY));
  } catch {
    return [];
  }
};

/** Whether a section is folded, and a toggle that saves it (and updates other copies). */
export function useCollapsed(id: string): [boolean, () => void] {
  const [collapsed, setState] = useState(false);
  useEffect(() => {
    const sync = () => setState(read().includes(id));
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, [id]);
  const toggle = useCallback(() => {
    // Read fresh, so folding one section never undoes another.
    const next = !read().includes(id);
    try {
      localStorage.setItem(KEY, JSON.stringify(setCollapsed(read(), id, next)));
    } catch {
      // This page only.
    }
    setState(next);
    window.dispatchEvent(new Event(EVENT));
  }, [id]);
  return [collapsed, toggle];
}
