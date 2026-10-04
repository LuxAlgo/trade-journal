/**
 * Bounded copy for AI notices as message KEYS in the `ai` namespace (en is the
 * semantic baseline; docs/i18n.md §5/§9). Matching still runs on the server's
 * stable English error text — never rewrite that text to fit these patterns.
 */
export interface AiFeedback {
  titleKey: string;
  descriptionKey: string;
  tone: "info" | "error";
  action?: { labelKey: string; href: string };
  retry?: boolean;
}

const title = (group: string) => `feedback.${group}.title`;
const description = (group: string) => `feedback.${group}.description`;

/** Friendly, bounded copy: never echo provider payloads or credentials into the UI. */
export function aiFeedback(message: string): AiFeedback {
  if (/^No (?:closed )?trades match/.test(message))
    return {
      titleKey: title("noMatchingTrades"),
      descriptionKey: description("noMatchingTrades"),
      tone: "info",
    };
  if (
    /^A selected account no longer exists|^Invalid .* filter|^Invalid .* (?:date|time|number|range)|^Unknown journal filter|^filters is required|^From date must/.test(
      message,
    )
  )
    return {
      titleKey: title("checkFilters"),
      descriptionKey: description("checkFilters"),
      tone: "info",
    };
  if (/^Journal timezone changed/.test(message))
    return {
      titleKey: title("refreshJournal"),
      descriptionKey: description("refreshJournal"),
      tone: "info",
    };
  if (/AI is not configured/i.test(message))
    return {
      titleKey: title("setUpAi"),
      descriptionKey: description("setUpAi"),
      tone: "info",
      action: { labelKey: "action.setUp", href: "/settings#ai-settings" },
    };
  if (
    /invalid.*(?:api.?key|x-api-key)|incorrect api key|authentication_error|invalid_api_key/i.test(
      message,
    )
  )
    return {
      titleKey: title("checkConnection"),
      descriptionKey: description("checkConnection"),
      tone: "error",
      action: { labelKey: "action.reviewSettings", href: "/settings#ai-settings" },
    };
  if (
    /credit balance|billing|insufficient.*(?:credit|quota)|exceeded your current quota/i.test(
      message,
    )
  )
    return { titleKey: title("billing"), descriptionKey: description("billing"), tone: "info" };
  if (/model unavailable|model_not_found/i.test(message))
    return {
      titleKey: title("checkModel"),
      descriptionKey: description("checkModel"),
      tone: "error",
      action: { labelKey: "action.reviewSettings", href: "/settings#ai-settings" },
    };
  if (/rate.limit|too many requests|overloaded/i.test(message))
    return {
      titleKey: title("rateLimit"),
      descriptionKey: description("rateLimit"),
      tone: "info",
      retry: true,
    };
  if (/journal is empty/i.test(message))
    return {
      titleKey: title("emptyJournal"),
      descriptionKey: description("emptyJournal"),
      tone: "info",
      action: { labelKey: "action.importTrades", href: "/import" },
    };
  if (/No closed trades on this day/i.test(message))
    return { titleKey: title("noRecap"), descriptionKey: description("noRecap"), tone: "info" };
  if (/Unauthorized/i.test(message))
    return {
      titleKey: title("signIn"),
      descriptionKey: description("signIn"),
      tone: "info",
      action: { labelKey: "action.signIn", href: "/login" },
    };
  if (/failed to fetch|network|timeout|timed out|connection/i.test(message))
    return {
      titleKey: title("connection"),
      descriptionKey: description("connection"),
      tone: "error",
      retry: true,
    };
  return {
    titleKey: title("fallback"),
    descriptionKey: description("fallback"),
    tone: "error",
    retry: true,
  };
}
