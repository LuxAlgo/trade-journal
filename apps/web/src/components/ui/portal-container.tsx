"use client";

import { createContext, useContext } from "react";

/**
 * Where menus, tooltips and selects portal to. Full screen shows only the full-screen
 * element's subtree, so a full-screen chart points its popups inside itself.
 */
export const PortalContainer = createContext<HTMLElement | null>(null);

export const usePortalContainer = () => useContext(PortalContainer) ?? undefined;
