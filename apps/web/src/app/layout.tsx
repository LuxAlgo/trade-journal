import { Suspense } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/shell";
import { PrivacyProvider } from "@/components/privacy";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Trade Journal",
  description:
    "The open-source trade journal — broker sync, deep analytics, daily journaling, and AI-native reflection. Self-hosted, free forever.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <TooltipProvider delayDuration={350} skipDelayDuration={150}>
          <Suspense>
            <ThemeProvider>
              <PrivacyProvider>
                <Shell>{children}</Shell>
              </PrivacyProvider>
            </ThemeProvider>
          </Suspense>
        </TooltipProvider>
      </body>
    </html>
  );
}
