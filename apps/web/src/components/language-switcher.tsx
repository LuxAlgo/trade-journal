"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { localeLabels, locales, type Locale } from "@/i18n/config";

/**
 * Interface language picker (T11). Lists all seven supported languages under
 * their own names, persists the choice via POST /api/locale and refreshes the
 * server components only after the cookie write succeeded. On failure the old
 * language stays active and an inline, announced error is shown.
 */
export function LanguageSwitcher() {
  const t = useTranslations("common");
  const router = useRouter();
  const current = useLocale();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const change = async (locale: Locale) => {
    if (pending || locale === current) return;
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (!response.ok) throw new Error(`Locale save failed with status ${response.status}`);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            aria-label={t("language.switch")}
          >
            <Languages aria-hidden="true" />
            {localeLabels[current as Locale] ?? current}
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {locales.map((locale) => (
            <DropdownMenuItem
              key={locale}
              disabled={pending}
              onSelect={() => void change(locale)}
              aria-current={locale === current ? "true" : undefined}
            >
              <Check
                aria-hidden="true"
                className={cn("size-4", locale === current ? "opacity-100" : "opacity-0")}
              />
              {localeLabels[locale]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {failed ? (
        <p role="alert" aria-live="polite" className="text-sm text-destructive">
          {t("language.error")}
        </p>
      ) : null}
    </div>
  );
}
