import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./features/shell/ErrorBoundary";
import { installErrorReporter } from "./lib/errorReporter";
import { initNativeShell } from "./lib/nativeShell";
import "./index.css";

// Before anything renders, so a crash during the first paint is still caught.
installErrorReporter();

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
