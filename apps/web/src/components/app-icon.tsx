import { APP_BACKGROUND } from "@/lib/pwa";

/**
 * The installed app's icon, drawn from code (no image files): three candles on the app
 * background. `maskable` keeps the glyph inside the safe zone launchers crop to.
 */
export function AppIcon({ size, maskable }: { size: number; maskable: boolean }) {
  const inset = maskable ? 0.22 : 0.12;
  const inner = size * (1 - inset * 2);
  const candles = [
    { x: 0.2, top: 0.34, body: 0.3, wick: 0.5, color: "#22c55e" },
    { x: 0.45, top: 0.18, body: 0.42, wick: 0.62, color: "#22c55e" },
    { x: 0.7, top: 0.4, body: 0.26, wick: 0.44, color: "#ef4444" },
  ];
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        background: APP_BACKGROUND,
        borderRadius: maskable ? 0 : size * 0.22,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: inner, height: inner, display: "flex", position: "relative" }}>
        {candles.map((c) => (
          <div key={c.x} style={{ display: "flex" }}>
            <div
              style={{
                position: "absolute",
                left: inner * (c.x + 0.07) - Math.max(1, inner * 0.012),
                top: inner * (c.top - (c.wick - c.body) / 2),
                width: Math.max(2, inner * 0.024),
                height: inner * c.wick,
                background: c.color,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: inner * c.x,
                top: inner * c.top,
                width: inner * 0.14,
                height: inner * c.body,
                background: c.color,
                borderRadius: inner * 0.02,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
