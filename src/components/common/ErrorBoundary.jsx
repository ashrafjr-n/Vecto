import { Component } from "react";

/**
 * Catches render/lifecycle errors in the subtree and shows a recovery panel
 * instead of unmounting the whole app to a blank page.
 *
 * Must be a class: React exposes no hook equivalent — getDerivedStateFromError /
 * componentDidCatch only exist on class components, and a try/catch inside a
 * function component cannot catch errors thrown during a child's render.
 *
 * Does NOT catch: event-handler errors, async/promise rejections, or SSR errors.
 */
class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No telemetry backend — the console is the only sink available.
    console.error("ErrorBoundary caught an error:", error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    /* Same frame as NotFound, but no shared Header: it reads the session context
       and the router, and either could be what just crashed. Links are plain
       <a href>, for the same reason. */
    return (
      <div role="alert" className="night flex min-h-screen flex-col bg-paper text-ink">
        <title>Something went wrong · Vecto</title>
        <header className="px-6 pt-5 sm:px-10">
          <a href="/" className="inline-block">
            <img src="/vecto-logo.png" alt="Vecto" width={538} height={238} className="h-9 w-auto sm:h-10" />
          </a>
        </header>
        <main className="flex flex-1 items-center px-6 pt-16 pb-24 sm:px-10">
          <div className="mx-auto w-full max-w-[1200px]">
            <p className="font-mono text-[13px] text-ink-faint">Error</p>
            <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.03em] text-ink sm:text-5xl">Something went wrong</h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">
              Vecto hit an unexpected problem and could not show this page. Your data never
              left your browser. Going back to the home page reloads Vecto and usually fixes it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {/* Full navigation, not a router push: a clean module reload (also clears
                  the datasetHandoff singleton, and fetches fresh chunks after a deploy)
                  even when the crash is deterministic and "Try again" would repeat it. */}
              <a href="/" className="rounded-xl bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90">
                Back to home
              </a>
              <button
                type="button"
                onClick={this.handleReset}
                className="rounded-xl border border-line-strong px-5 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:border-ink-faint"
              >
                Try again
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }
}

export default ErrorBoundary;
