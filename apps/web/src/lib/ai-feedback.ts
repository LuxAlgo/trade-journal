export interface AiFeedback {
  title: string;
  description: string;
  tone: "info" | "error";
  action?: { label: string; href: string };
  retry?: boolean;
}

/** Friendly, bounded copy: never echo provider payloads or credentials into the UI. */
export function aiFeedback(message: string): AiFeedback {
  if (/AI is not configured/i.test(message))
    return {
      title: "Set up AI to continue",
      description:
        "Connect your Anthropic API key in Settings to ask questions, generate recaps, and review trades.",
      tone: "info",
      action: { label: "Set up AI", href: "/settings#ai-settings" },
    };
  if (/invalid.*(?:api.?key|x-api-key)|authentication_error|invalid x-api-key/i.test(message))
    return {
      title: "Check your AI connection",
      description: "Anthropic couldn’t verify your API key. Update it in Settings, then try again.",
      tone: "error",
      action: { label: "Review AI settings", href: "/settings#ai-settings" },
    };
  if (/credit balance|billing|insufficient.*credit/i.test(message))
    return {
      title: "Your AI account needs attention",
      description: "Check the billing or credit balance on your Anthropic account, then try again.",
      tone: "info",
    };
  if (/rate.limit|too many requests|overloaded/i.test(message))
    return {
      title: "AI is temporarily busy",
      description: "Please wait a moment before trying again. Your journal data hasn’t changed.",
      tone: "info",
      retry: true,
    };
  if (/journal is empty/i.test(message))
    return {
      title: "Add trades to get started",
      description:
        "AI insights use your journal history. Import your trades, then ask your question again.",
      tone: "info",
      action: { label: "Import trades", href: "/import" },
    };
  if (/No closed trades on this day/i.test(message))
    return {
      title: "No trades to recap yet",
      description:
        "A recap needs at least one closed trade on this day. You can still write your own day note.",
      tone: "info",
    };
  if (/Unauthorized/i.test(message))
    return {
      title: "Please sign in again",
      description: "Your session may have expired. Sign in to continue using your journal.",
      tone: "info",
      action: { label: "Sign in", href: "/login" },
    };
  if (/failed to fetch|network|timeout|timed out|connection/i.test(message))
    return {
      title: "Couldn’t connect to AI",
      description: "Check your connection and try again. Your journal data hasn’t changed.",
      tone: "error",
      retry: true,
    };
  return {
    title: "Couldn’t complete the AI request",
    description: "Please try again in a moment. If this continues, check your AI settings.",
    tone: "error",
    retry: true,
  };
}
