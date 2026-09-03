"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Fade the current page before navigation, then reveal the committed route. */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const main = useRef<HTMLElement>(null);
  const animation = useRef<Animation | null>(null);
  const transition = useRef<ViewTransition | null>(null);
  const finishRoute = useRef<(() => void) | null>(null);
  const previousPath = useRef(pathname);
  const request = useRef(0);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    request.current++;
    if (timeout.current) clearTimeout(timeout.current);
    animation.current?.cancel();
    if (finishRoute.current) {
      finishRoute.current();
      finishRoute.current = null;
      return;
    }
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const enter = main.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 230,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      });
      animation.current = enter ?? null;
    }
  }, [pathname]);

  useEffect(() => {
    const container = main.current;
    // Navigation links also live in the persistent sidebar and mobile header.
    const navigate = async (event: globalThis.MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download"))
        return;
      const url = new URL(link.href, window.location.href);
      if (
        url.origin !== window.location.origin ||
        url.pathname === window.location.pathname ||
        url.pathname.startsWith("/api/")
      )
        return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !container) return;
      event.preventDefault();
      const token = ++request.current;
      if (timeout.current) clearTimeout(timeout.current);
      transition.current?.skipTransition();
      finishRoute.current?.();
      finishRoute.current = null;
      if (typeof document.startViewTransition === "function") {
        // Hold the old frame until the next route has committed. Slow routes
        // never leave a blank page between the fade-out and fade-in.
        animation.current?.cancel();
        const next = document.startViewTransition(
          () =>
            new Promise<void>((resolve) => {
              if (request.current !== token) {
                resolve();
                return;
              }
              finishRoute.current = resolve;
              router.push(`${url.pathname}${url.search}${url.hash}`);
              timeout.current = setTimeout(() => {
                if (request.current !== token) return;
                next.skipTransition();
                finishRoute.current = null;
                resolve();
              }, 2500);
            }),
        );
        transition.current = next;
        void next.ready.catch(() => {});
        void next.finished
          .catch(() => {})
          .then(() => {
            if (transition.current === next) transition.current = null;
          });
        return;
      }
      const opacity = getComputedStyle(container).opacity;
      animation.current?.cancel();
      const exit = container.animate([{ opacity }, { opacity: 0 }], {
        duration: 120,
        easing: "ease-out",
        fill: "forwards",
      });
      animation.current = exit;
      try {
        await exit.finished;
      } catch {
        return;
      }
      if (request.current !== token) return;
      router.push(`${url.pathname}${url.search}${url.hash}`);
      // A failed or cancelled navigation must never leave the page invisible.
      timeout.current = setTimeout(() => {
        if (request.current === token) animation.current?.cancel();
      }, 2000);
    };
    document.addEventListener("click", navigate, true);
    return () => {
      document.removeEventListener("click", navigate, true);
      request.current++;
      animation.current?.cancel();
      transition.current?.skipTransition();
      finishRoute.current?.();
      finishRoute.current = null;
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [router]);

  return (
    <main ref={main} className="journal-main min-w-0 flex-1" data-page-transition>
      {children}
    </main>
  );
}
