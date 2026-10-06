"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LuxAlgoMark } from "@/components/luxalgo-mark";
import { postJson, useApi } from "@/lib/use-api";
import { safeReturnTo } from "@/lib/auth-redirect";

interface AuthMethods {
  required: boolean;
  password: boolean;
  oidc: { label: string; problem: string | null } | null;
}

/** What went wrong with single sign-on, from the code the callback sends back. */
const SSO_ERRORS: Record<string, string> = {
  config: "Single sign-on is not configured correctly. The server log says what to fix.",
  unavailable: "The sign-in provider could not be reached. Try again in a moment.",
  denied: "The sign-in provider did not sign you in.",
  state: "That sign-in expired or was already used. Start again.",
  token: "The sign-in provider's answer could not be verified. The server log has details.",
  forbidden: "Your account is not allowed into this journal.",
  unexpected: "Sign-in failed. Try again.",
};

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeReturnTo(params.get("next"));
  const failure = params.get("error");
  const { data: methods } = useApi<AuthMethods>("/api/auth");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await postJson("/api/auth", { password });
      router.push(next);
      router.refresh();
    } catch {
      setError("Wrong password");
    }
  };

  const sso = methods?.oidc;
  // Before the methods load, offer the password form as before (the only method then).
  const showPassword = methods ? methods.password : !failure;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-80">
        <CardContent className="space-y-3 pt-6">
          <div className="text-center">
            <LuxAlgoMark className="mx-auto mb-2 h-6 w-7" />
            <h1 className="text-sm font-semibold">Trade Journal</h1>
          </div>
          {failure && (
            <p role="alert" className="text-center text-xs text-loss">
              {SSO_ERRORS[failure] ?? SSO_ERRORS.unexpected}
            </p>
          )}
          {params.get("signed_out") && !failure && (
            <p role="status" className="text-center text-xs text-muted-foreground">
              Signed out.
            </p>
          )}
          {sso &&
            (sso.problem ? (
              !failure && (
                <p role="alert" className="text-center text-xs text-loss">
                  {sso.problem}
                </p>
              )
            ) : (
              <Button asChild className="w-full">
                <a href={`/api/auth/oidc/login?${new URLSearchParams({ next })}`}>
                  <KeyRound aria-hidden="true" /> Sign in with {sso.label}
                </a>
              </Button>
            ))}
          {sso && showPassword && (
            <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
              or
            </p>
          )}
          {showPassword && (
            <form onSubmit={submit} className="space-y-3">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                aria-label="Password"
                autoFocus={!sso}
              />
              {error && <p className="text-center text-xs text-loss">{error}</p>}
              <Button type="submit" className="w-full" variant={sso ? "outline" : "default"}>
                Unlock
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
