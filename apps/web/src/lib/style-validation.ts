/**
 * The style values chart settings, drawing templates and layers store, checked the same way
 * everywhere. Stored documents are rejected as a whole when one value fails, so these rules
 * only ever get looser.
 */

/** Colours as Vela writes them: hex (3 to 8 digits) or rgb()/rgba(). */
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]{5,60}\))$/;
export const isColor = (value: unknown): value is string =>
  typeof value === "string" && COLOR.test(value);

/** A plain `#rrggbb` colour, as a colour picker gives. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && HEX_COLOR.test(value);

/** A Vela drawing type or similar key. */
export const TOOL_KEY = /^[A-Za-z0-9_-]{1,40}$/;

export const LINE_STYLES = ["solid", "dashed", "dotted"] as const;
export type LineStyle = (typeof LINE_STYLES)[number];
export const isLineStyle = (value: unknown): value is LineStyle =>
  (LINE_STYLES as readonly unknown[]).includes(value);

export const TEXT_SIZES = ["tiny", "small", "normal", "large", "huge"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const isTextSize = (value: unknown): value is TextSize =>
  (TEXT_SIZES as readonly unknown[]).includes(value);
