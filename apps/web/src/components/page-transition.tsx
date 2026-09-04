"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/** Reveal committed pages without delaying navigation or freezing the old screen. */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const main = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);

  useLayoutEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) return;
    const animation = main.current?.animate([{ opacity: 0.65 }, { opacity: 1 }], {
      duration: 160,
      easing: "ease-out",
    });
    const settle = () => {
      if (motion.matches) animation?.cancel();
    };
    motion.addEventListener("change", settle);
    return () => {
      animation?.cancel();
      motion.removeEventListener("change", settle);
    };
  }, [pathname]);

  return (
    <main ref={main} className="journal-main min-w-0 flex-1" data-page-transition>
      {children}
    </main>
  );
}
