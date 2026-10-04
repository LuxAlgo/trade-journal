import { cookies } from "next/headers";
import { bad, handler, ok } from "@/server/api";
import { isValidLocale, LOCALE_COOKIE } from "@/i18n/config";

/**
 * Persists the interface language in the NEXT_LOCALE cookie. Public by design:
 * language choice must work before login (T10). Only enum members are accepted;
 * anything else is a 400 and no cookie is written.
 */
export const POST = handler(
  async (request: Request) => {
    const body = (await request.json().catch(() => null)) as { locale?: unknown } | null;
    const locale = body?.locale;
    if (!isValidLocale(locale)) return bad("Invalid locale", 400, "invalid_locale");
    (await cookies()).set(LOCALE_COOKIE, locale, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      httpOnly: true,
      // `secure` is intentionally omitted: the journal is commonly served over
      // plain HTTP on localhost and self-hosted boxes (matches the auth cookie's
      // protocol-aware tradeoff without over-rejecting HTTP deployments).
    });
    return ok({ locale });
  },
  { public: true },
);
