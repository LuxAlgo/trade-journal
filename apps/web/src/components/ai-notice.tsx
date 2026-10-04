"use client";

import Link from "next/link";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpRight, CircleAlert, Sparkles, X } from "lucide-react";
import { aiFeedback } from "@/lib/ai-feedback";
import { Button } from "./ui/button";

export function AiNotice({
  error,
  onRetry,
  onDismiss,
}: {
  error: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("ai");
  const feedback = aiFeedback(error);
  const id = useId();
  const Icon = feedback.tone === "error" ? CircleAlert : Sparkles;
  return (
    <div
      data-ai-notice
      role={feedback.tone === "error" ? "alert" : "status"}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      className="flex items-start gap-3 rounded-xl border bg-muted/25 p-4"
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${feedback.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p id={`${id}-title`} className="text-sm font-medium leading-5">
          {t(feedback.titleKey)}
        </p>
        <p
          id={`${id}-description`}
          className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground"
        >
          {t(feedback.descriptionKey)}
        </p>
        {feedback.action ? (
          <Link
            href={feedback.action.href}
            className="mt-3 inline-flex items-center gap-1 rounded text-xs font-medium underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-current"
          >
            {t(feedback.action.labelKey)}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : feedback.retry ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 h-8 text-xs"
            onClick={onRetry}
          >
            {t("tryAgain")}
          </Button>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-mr-1 -mt-1 h-7 w-7 shrink-0 text-muted-foreground"
        aria-label={t("dismiss")}
        onClick={onDismiss}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
