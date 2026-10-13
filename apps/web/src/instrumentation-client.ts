/**
 * Runs in the browser before the app starts (Next.js convention): registers the service
 * worker that makes the journal installable and shows background alert notifications.
 */
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Plain http (other than localhost) cannot register one; the site still works.
    });
  });
}
