"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LuxAlgoMark } from "@/components/luxalgo-mark";
import { postJson } from "@/lib/use-api";
import { useI18n } from "@/components/locale";

export default function LoginPage() {
  const { text } = useI18n();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await postJson("/api/auth", { password });
      router.push("/");
      router.refresh();
    } catch {
      setError(text.login.wrong);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-80">
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-3">
            <div className="text-center">
              <LuxAlgoMark className="mx-auto mb-2 h-6 w-7" />
              <h1 className="text-sm font-semibold">{text.brand}</h1>
            </div>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={text.login.password}
              autoFocus
            />
            {error && <p className="text-center text-xs text-loss">{error}</p>}
            <Button type="submit" className="w-full">
              {text.login.unlock}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
