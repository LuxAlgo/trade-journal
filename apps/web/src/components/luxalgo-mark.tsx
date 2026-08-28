// The LuxAlgo mark (two chevron strokes). Geometry is unchanged from the
// official logo; renders in currentColor so it follows the theme.
export function LuxAlgoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 41 37" role="img" fill="currentColor" className={className}>
      <title>LuxAlgo</title>
      <path d="M36.217 34.646l4.139-7.231L25.868 2.108 11.381 27.415h8.279l6.209-10.845z" />
      <path d="M31.042 29.224 8.267 29.22 24.833.3h-8.277L0 29.216l4.137 7.237h31.045z" />
    </svg>
  );
}
