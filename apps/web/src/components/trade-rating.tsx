"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function TradeRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => Promise<void>;
}) {
  const t = useTranslations("trade-detail");
  const [rating, setRating] = useState(value);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [selection, setSelection] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setRating(value), [value]);
  const preview = hovered ?? focused ?? rating ?? 0;

  const select = async (star: number) => {
    if (saving) return;
    const previous = rating;
    const next = rating === star ? null : star;
    setRating(next);
    setSelection((current) => current + 1);
    setSaving(true);
    setError("");
    try {
      await onChange(next);
    } catch {
      setRating(previous);
      setError(t("rating.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div
        role="group"
        aria-label={t("rating.groupAria")}
        className="flex items-center gap-0.5"
        onPointerLeave={() => setHovered(null)}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            aria-label={t("rating.rateAria", { count: star })}
            aria-pressed={rating === star}
            aria-disabled={saving}
            onPointerEnter={() => setHovered(star)}
            onFocus={() => setFocused(star)}
            onBlur={() => setFocused(null)}
            onClick={() => void select(star)}
            className={cn(
              "journal-rating-star flex size-7 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              star <= preview ? "text-amber-500 dark:text-amber-400" : "text-muted-foreground/50",
            )}
          >
            <Star
              key={selection}
              data-filled={star <= preview}
              className={cn(
                "size-[18px] transition-[fill,color] duration-150",
                star <= preview && "fill-current",
                selection > 0 && star <= (rating ?? 0) && "journal-rating-selected",
              )}
              style={{ animationDelay: `${(star - 1) * 25}ms` }}
            />
          </button>
        ))}
        <span className="ml-2 min-w-7 text-xs tabular-nums text-muted-foreground">
          {preview ? `${preview}/5` : "—"}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
