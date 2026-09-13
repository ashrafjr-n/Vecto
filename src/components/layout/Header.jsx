import { NavLink, useNavigate } from "react-router-dom";

/* Fixed, full-width, edge-to-edge — NOT floating/pill-shaped. See frontend.md
   "Header" spec. Shared by every page (Home + Methodology + the /analyze flow).

   The bar wears the PANEL surface, not the canvas: every page opens on a
   paper-sunken hero, so the header reads as the top edge of that panel rather
   than a darker strip laid over it. Side padding matches the pages' own
   (px-6 / sm:px-10, OUTSIDE the 1400px box, as the page sections do), so the
   logo sits on the same left edge as the content at every width. */
function Header() {
  const navigate = useNavigate();

  return (
    <header className="fixed top-0 left-0 z-50 h-16 w-full border-b border-line bg-paper-sunken/85 px-6 backdrop-blur sm:px-10">
      <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between">

        <nav aria-label="Primary" className="flex items-center gap-5 sm:gap-8">
          <button
            type="button"
            onClick={() => { window.scrollTo(0, 0); navigate("/"); }}
            aria-label="Vecto home"
            className="flex items-center"
          >
            {/* Wordmark, not a symbol — it carries the name, so no text sits beside it.
                White artwork: legible only because every page renders in `.night`. */}
            <img src="/vecto-logo.png" alt="Vecto" width={538} height={238} className="h-10 w-auto" />
          </button>

          <span aria-hidden="true" className="h-5 w-px bg-line-strong" />

          {/* scrollTo in the handler: BrowserRouter keeps the previous page's
              scroll position, which would open a long page halfway down. */}
          <NavLink
            to="/methodology"
            onClick={() => window.scrollTo(0, 0)}
            className={({ isActive }) =>
              isActive
                ? "text-[13px] font-medium text-ink"
                : "text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"}
          >
            Methodology
          </NavLink>
        </nav>

        {/* Placeholder — no auth is wired yet. Same ink-on-light treatment as the
            page CTAs, so the one action in the bar matches every other action. */}
        <button
          type="button"
          className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
        >
          Log in
        </button>

      </div>
    </header>
  );
}

export default Header;
