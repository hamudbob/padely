import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./features/shell/ErrorBoundary";
import { installErrorReporter } from "./lib/errorReporter";
import { initNativeShell } from "./lib/nativeShell";
import { startProviderTokenCapture } from "./lib/supabase/providerTokens";
import "./index.css";

// Before anything renders, so a crash during the first paint is still caught.
installErrorReporter();

// Apple hands the provider refresh token over exactly once, on the SIGNED_IN
// event, and never again. This has to be listening BEFORE React renders — on a
// cold start returning from Apple with a ?code= in the URL the exchange can
// complete before any component has mounted, and a listener attached from a
// hook would miss it. See lib/supabase/providerTokens.ts.
startProviderTokenCapture();

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
