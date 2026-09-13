import { useNavigate } from "react-router-dom";

/* Fixed, full-width, edge-to-edge — NOT floating/pill-shaped. See frontend.md
   "Header" spec. Shared by every page (Home + the whole /analyze flow). */
function Header() {
  const navigate = useNavigate();

  return (
    <header className="fixed top-0 left-0 z-50 w-full h-16 bg-paper/90 backdrop-blur border-b border-line">
      <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between px-6 sm:px-12">

        <button
          type="button"
          onClick={() => navigate("/")}
          aria-label="Vecto home"
          className="flex items-center"
        >
          {/* Wordmark, not a symbol — it carries the name, so no text sits beside it.
              White artwork: legible only because every page renders in `.night`. */}
          <img src="/vecto-logo.png" alt="Vecto" width={538} height={238} className="h-8 w-auto" />
        </button>

        <button
          type="button"
          className="inline-flex items-center rounded-md border border-gold bg-transparent px-4 py-2 text-[13px] font-semibold text-gold-ink transition-colors hover:bg-gold-tint"
        >
          Start for Free
        </button>

      </div>
    </header>
  );
}

export default Header;
