import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./features/shell/ErrorBoundary";
import { installErrorReporter } from "./lib/errorReporter";
import { initNativeShell, dismissSplash } from "./lib/nativeShell";
import "./index.css";

// Before anything renders, so a crash during the first paint is still caught.
installErrorReporter();

// Status bar styling, before the first paint so it never flashes wrong.
// No-op in a browser.
void initNativeShell();

// The launch screen goes when there is something behind it — not on a timer,
// which either flashes white on a slow start or holds a static logo after the
// app is already usable.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);

void dismissSplash();
