import { NavLink, useNavigate } from "react-router-dom";

/* Fixed, full-width, edge-to-edge — NOT floating/pill-shaped. See frontend.md
   "Header" spec. Shared by every page (Home + Methodology + the /analyze flow).

   The bar wears the PANEL surface, not the canvas: every page opens on a
   paper-sunken hero, so the header reads as the top edge of that panel rather
   than a darker strip laid over it. Side padding matches the pages' own
   (px-6 / sm:px-10, OUTSIDE the 1400px box, as the page sections do), so the
   logo sits on the same left edge as the content at every width. */
/* About is the one link that gives way on a phone: it is also in the footer, and
   the bar has to fit the wordmark, Methodology and Log in at 375px. */
const NAV = [
  { to: "/methodology", label: "Methodology" },
  { to: "/about",       label: "About", wide: true },
];

function Header() {
  const navigate = useNavigate();

  return (
    <header className="fixed top-0 left-0 z-50 h-16 w-full border-b border-line bg-paper-sunken/85 px-6 backdrop-blur sm:px-10">
      <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between">

        <nav aria-label="Primary" className="flex items-center gap-4 sm:gap-7">
          <button
            type="button"
            onClick={() => { window.scrollTo(0, 0); navigate("/"); }}
            aria-label="Vecto home"
            className="flex items-center"
          >
            {/* Wordmark, not a symbol — it carries the name, so no text sits beside it.
                White artwork: legible only because every page renders in `.night`. */}
            <img src="/vecto-logo.png" alt="Vecto" width={538} height={238} className="h-9 w-auto sm:h-10" />
          </button>

          <span aria-hidden="true" className="hidden h-5 w-px bg-line-strong sm:block" />

          {/* scrollTo in the handler: BrowserRouter keeps the previous page's
              scroll position, which would open a long page halfway down. */}
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => window.scrollTo(0, 0)}
              className={({ isActive }) =>
                `${item.wide ? "hidden sm:inline" : ""} text-[13px] font-medium transition-colors ${isActive ? "text-ink" : "text-ink-soft hover:text-ink"}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Placeholder — no auth is wired yet; kept on purpose so the bar is designed
            with it (owner's call, 2026-09-22). Same treatment as the page CTAs. */}
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
