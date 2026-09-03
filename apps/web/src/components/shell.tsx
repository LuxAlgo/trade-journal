"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FILTER_KEYS } from "@luxalgo/journal-core";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  BookText,
  CalendarDays,
  Import,
  LayoutDashboard,
  ListOrdered,
  NotebookPen,
  Settings,
  ListChecks,
  BookmarkPlus,
  Wallet,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LuxAlgoMark } from "@/components/luxalgo-mark";
import { PrivacyToggle } from "./privacy";
import { PageTransition } from "./page-transition";
import { Button } from "./ui/button";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/journal", label: "Daily journal", icon: NotebookPen },
  { href: "/trades", label: "Trades", icon: ListOrdered },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/notebook", label: "Notebook", icon: BookText },
  { href: "/playbooks", label: "Playbooks", icon: BookOpen },
  { href: "/progress", label: "Progress", icon: ListChecks },
  { href: "/missed", label: "Missed trades", icon: BookmarkPlus },
] as const;

const NAV_SETUP = [
  { href: "/import", label: "Import", icon: Import },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className={cn("h-4 w-4", active && "text-brand")} />
      {label}
    </Link>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  const filterQuery = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = search.get(key);
    if (value) filterQuery.set(key, value);
  }
  if (search.get("range")) filterQuery.set("range", search.get("range")!);
  if (pathname === "/login") return <>{children}</>;
  const navigation = (
    <nav
      aria-label="Journal navigation"
      className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain p-2"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) setMenuOpen(false);
      }}
    >
      {NAV.map(({ href, label, icon }) => (
        <NavLink
          key={href}
          href={filterQuery.size ? `${href}?${filterQuery}` : href}
          label={label}
          icon={icon}
          active={href === "/" ? pathname === "/" : pathname.startsWith(href)}
        />
      ))}
      <div className="!my-3 border-t" />
      {NAV_SETUP.map(({ href, label, icon }) => (
        <NavLink
          key={href}
          href={filterQuery.size ? `${href}?${filterQuery}` : href}
          label={label}
          icon={icon}
          active={pathname.startsWith(href)}
        />
      ))}
    </nav>
  );
  const footer = (
    <div className="space-y-1 border-t p-3 text-xs text-muted-foreground">
      <div>
        Open source ·{" "}
        <a
          href="https://github.com/LuxAlgo/trade-journal"
          className="underline underline-offset-2 hover:text-foreground"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </div>
      <div>Not investment advice.</div>
    </div>
  );
  return (
    <div className="journal-shell min-h-dvh lg:flex">
      <header className="journal-mobile-header sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur lg:hidden">
        <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DialogPrimitive.Trigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="journal-nav-overlay fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
            <DialogPrimitive.Content
              className="journal-nav-drawer fixed inset-y-0 left-0 z-50 flex w-[min(288px,calc(100vw-40px))] flex-col border-r bg-card shadow-2xl"
              aria-describedby={undefined}
            >
              <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
                <LuxAlgoMark className="h-[18px] w-5" />
                <DialogPrimitive.Title className="text-sm font-semibold">
                  Trade Journal
                </DialogPrimitive.Title>
                <DialogPrimitive.Close asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-8 w-8"
                    aria-label="Close navigation"
                  >
                    <X />
                  </Button>
                </DialogPrimitive.Close>
              </div>
              {navigation}
              <div className="border-t p-3">
                <PrivacyToggle />
              </div>
              {footer}
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
        <Link
          href="/"
          className="mr-auto flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <LuxAlgoMark className="hidden h-4 w-[18px] shrink-0 min-[380px]:block" />
          <span className="truncate">Trade Journal</span>
        </Link>
        <PrivacyToggle compact />
      </header>
      <aside className="journal-desktop-sidebar sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r bg-card/50 lg:flex">
        <Link href="/" className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
          <LuxAlgoMark className="h-[18px] w-5 shrink-0" />
          <span className="text-sm font-semibold tracking-tight">Trade Journal</span>
        </Link>
        {navigation}
        <div className="border-t p-3">
          <PrivacyToggle />
        </div>
        {footer}
      </aside>
      <PageTransition>{children}</PageTransition>
    </div>
  );
}
