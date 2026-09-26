# Install as an app

The journal installs from the browser as an app with its own window, icon and launcher entry,
on desktop (Chrome, Edge) and phones (Chrome on Android; Safari's "Add to Home Screen" on iPhone
and iPad). It is still your server: nothing is stored on the device, and new versions of the
journal show up without reinstalling.

## Install

1. Serve the journal over **https** (a browser installs apps only from secure origins;
   `localhost` also works). Set `JOURNAL_PASSWORD` if it is reachable from the internet.
2. Open it in the browser:
   - Chrome or Edge on a computer: the install icon in the address bar, or menu → **Install**.
   - Chrome on Android: menu → **Install app** (or **Add to Home screen**).
   - Safari on iPhone or iPad: Share → **Add to Home Screen**.
3. For alerts on that device, open Charts → Alerts → **Notify this browser** from the installed
   app (see [alerts.md](alerts.md)).

`JOURNAL_APP_NAME` and `JOURNAL_APP_SHORT_NAME` rename the installed app.

## What makes it installable

- `app/manifest.ts`: the web app manifest (name, colours, icons, shortcuts to Charts, the daily
  journal and trades). Next.js adds the manifest link to every page.
- `app/icons/[name]/route.tsx` and `app/apple-icon.tsx`: icons drawn from code
  (`components/app-icon.tsx`), including a maskable one for Android launchers.
- `public/sw.js`, registered by `instrumentation-client.ts` (a Next.js convention that runs in
  the browser before the app): shows a "server can't be reached" page when offline and displays
  push notifications. It caches no journal data.
- With `JOURNAL_PASSWORD`, the manifest, service worker and icons are served without a session
  (`lib/pwa.ts`, checked by the middleware), because the browser fetches them without cookies.
  None contains journal data.
