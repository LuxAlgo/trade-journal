"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LuxAlgoMark } from "@/components/luxalgo-mark";
import { formatApiError } from "@/lib/api-error";
import { postJson } from "@/lib/use-api";

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("auth");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      await postJson("/api/auth", { password });
      router.push("/");
      router.refresh();
    } catch (cause) {
      // Known codes (e.g. wrong_password) localize via the errors namespace;
      // anything else keeps the server's original English text (i18n.md §6).
      setError(formatApiError(tErrors, cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-80">
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-3">
            <div className="text-center">
              <LuxAlgoMark className="mx-auto mb-2 h-6 w-7" />
              <h1 className="text-sm font-semibold">Trade Journal</h1>
            </div>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("passwordPlaceholder")}
              autoFocus
            />
            {error && <p className="text-center text-xs text-loss">{error}</p>}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? t("signingIn") : t("unlock")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
