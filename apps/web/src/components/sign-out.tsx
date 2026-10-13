"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { postJson, useApi } from "@/lib/use-api";
import { Button } from "./ui/button";

interface AuthState {
  required: boolean;
  session: { method: "oidc" | "password"; name: string; email: string } | null;
}

/**
 * Sign out, shown only when the journal requires a sign-in. A single sign-on session ends
 * on the server, then (with provider logout on) at the provider too.
 */
export function SignOutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const { data } = useApi<AuthState>("/api/auth");
  const [busy, setBusy] = useState(false);
  if (!data?.required || !data.session) return null;
  const who = data.session.name || data.session.email;
  const label = who ? `Sign out (${who})` : "Sign out";
  const signOut = async () => {
    setBusy(true);
    try {
      const { redirect } = await postJson<{ redirect: string }>("/api/auth/logout", {});
      window.location.assign(redirect === "/login" ? "/login?signed_out=1" : redirect);
    } catch {
      window.location.assign("/login");
    }
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size={iconOnly ? "icon" : "sm"}
      className={
        iconOnly
          ? "h-9 w-9 shrink-0 rounded-lg"
          : "w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
      }
      disabled={busy}
      onClick={() => void signOut()}
      aria-label={label}
      title={iconOnly ? label : who || undefined}
    >
      <LogOut aria-hidden="true" />
      {!iconOnly && <span className="truncate">Sign out</span>}
    </Button>
  );
}
