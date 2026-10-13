/**
 * Whether the chart's drawing toolbar is hidden, remembered per browser and apart for the
 * normal view and full screen: on a small screen the tools can stay out of the way in full
 * screen and still show on the page.
 */
export interface ToolbarHidden {
  normal: boolean;
  fullscreen: boolean;
}

export const TOOLBAR_SHOWN: ToolbarHidden = { normal: false, fullscreen: false };

const KEY = "journal-chart-toolbar-v1";

export function parseToolbarHidden(raw: string | null): ToolbarHidden {
  if (!raw) return TOOLBAR_SHOWN;
  try {
    const value = JSON.parse(raw) as Partial<ToolbarHidden> | null;
    return { normal: value?.normal === true, fullscreen: value?.fullscreen === true };
  } catch {
    return TOOLBAR_SHOWN;
  }
}

export const toolbarPreference = {
  read(): ToolbarHidden {
    try {
      return parseToolbarHidden(localStorage.getItem(KEY));
    } catch {
      return TOOLBAR_SHOWN;
    }
  },
  write(value: ToolbarHidden) {
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // This page only.
    }
  },
};
