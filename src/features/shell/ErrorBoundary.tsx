import { Component, ErrorInfo, ReactNode } from "react";
import { reportError } from "../../lib/errorReporter";

/**
 * The last line of defence. A render-time exception anywhere below this
 * unmounts the whole React tree, and without a boundary that means a white
 * screen with no explanation — the single worst thing this app can do to
 * someone standing on a court mid-session.
 *
 * So: catch it, report it, and show something that admits what happened and
 * offers the two ways out. Reload first, because the app's state lives in the
 * database and localStorage, not in memory — a reload almost always works,
 * and any scores entered offline are still queued.
 */
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, "boundary", { componentStack: info.componentStack?.slice(0, 2000) });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-10 safe-top">
        <p className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none">
          Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
        </p>

        <h1 className="font-serif text-[26px] font-semibold text-graphite mt-8 leading-tight">
          That didn’t load.
        </h1>
        <p className="text-[14px] text-ink-2 mt-2.5 leading-relaxed">
          Something broke on this screen. It’s been logged, so it can be fixed. Nothing you entered
          is lost — scores are saved on this device and sync on their own.
        </p>

        <button
          onClick={() => window.location.reload()}
          className="w-full mt-7 rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
        >
          Reload
        </button>
        <a
          href="/"
          className="block w-full mt-2.5 rounded-full px-4 py-3 text-center font-semibold text-[14px] border-[1.5px] border-line text-ink-2 bg-surface active:scale-[0.99] transition-transform"
        >
          Back to sessions
        </a>

        {/* The message itself, small and last. Useless to most people, and the
            first thing worth having when someone sends a screenshot. */}
        <p className="mt-6 text-[11px] text-warm-gray break-words font-mono">{error.message}</p>
      </div>
    );
  }
}
