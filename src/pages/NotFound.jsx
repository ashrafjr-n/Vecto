import { Link } from "react-router-dom";

import Header from "../components/layout/Header.jsx";
import Footer from "../components/layout/Footer.jsx";

/* Any path no route claims. Before it, an unknown URL rendered an empty page. */
function NotFound() {
  return (
    <div className="night flex min-h-screen flex-col bg-paper text-ink">
      <title>Page not found · Vecto</title>
      <Header />
      <main className="flex flex-1 items-center px-6 pt-28 pb-24 sm:px-10">
        <div className="mx-auto w-full max-w-[1200px]">
          <p className="font-mono text-[13px] text-ink-faint">404</p>
          <h1 className="mt-2 text-[2rem] font-semibold tracking-[-0.03em] text-ink sm:text-5xl">Page not found</h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">
            There is nothing at this address. If you were in the middle of an analysis, reloading
            the page clears it — start again from the home page.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/" className="rounded-xl bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90">
              Analyze a dataset
            </Link>
            <Link to="/methodology" className="rounded-xl border border-line-strong px-5 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:border-ink-faint">
              Methodology
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default NotFound;
