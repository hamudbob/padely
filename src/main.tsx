import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./features/shell/ErrorBoundary";
import { installErrorReporter } from "./lib/errorReporter";
import { initNativeShell } from "./lib/nativeShell";
import { startProviderTokenCapture } from "./lib/supabase/providerTokens";
import { startCacheNamespace } from "./lib/cache/cacheStore";
import { startLocalSessionSync } from "./lib/offline/localSessionSync";
import "./index.css";

// Before anything renders, so a crash during the first paint is still caught.
installErrorReporter();

// Apple hands the provider refresh token over exactly once, on the SIGNED_IN
// event, and never again. This has to be listening BEFORE React renders — on a
// cold start returning from Apple with a ?code= in the URL the exchange can
// complete before any component has mounted, and a listener attached from a
// hook would miss it. See lib/supabase/providerTokens.ts.
startProviderTokenCapture();

// Ties the read cache to whoever is signed in, and ERASES it on sign-out.
// Before render for the same reason as above: a screen that mounts before the
// namespace is known simply misses the cache and fetches, which is only the
// old behaviour — but a screen that read from a namespace set a moment too
// late could show the previous user's clubs. See lib/cache/cacheStore.ts.
startCacheNamespace();

// Pushes any session started with no signal up to the server, and only then
// prods the score queue — the queue addresses matches by id, and for an
// offline session those rows don't exist server-side until the session lands.
// Flushing scores first would fail every one of them and eventually park them
// as un-syncable, losing an evening to the machinery meant to protect it.
startLocalSessionSync();

// Status bar styling, before the first paint so it never flashes wrong.
// No-op in a browser.
void initNativeShell();

// The launch screen is dismissed by LaunchVeil, not from here. Calling hide()
// straight after render() only guarantees React has been ASKED to render — the
// veil waits until it has actually painted, which is the difference between a
// clean handover and a white frame on a cold start.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
