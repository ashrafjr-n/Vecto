import Header from "./Header.jsx";
import Footer from "./Footer.jsx";

/* The frame every reading page shares — Methodology, About, Privacy, Terms: a
   title, a lead, then the content, with an "On this page" index that sticks
   beside it on large screens and folds into one line above it on small ones.
   Plain anchors, so a section is shareable by its hash. */
function DocPage({ title, docTitle, lead, toc, updated, children }) {
  return (
    <div className="night min-h-screen bg-paper text-ink">
      {/* React 19 hoists this into <head> for the life of the page. */}
      <title>{`${docTitle ?? title} · Vecto`}</title>
      <Header />

      <main className="px-6 pt-28 pb-24 sm:px-10 sm:pt-32">
        <div className="mx-auto max-w-[1200px]">

          <h1 className="max-w-[22ch] text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl">
            {title}
          </h1>
          {lead && <div className="mt-6 max-w-3xl space-y-4 text-[16px] leading-[1.7] text-ink-soft">{lead}</div>}
          {updated && <p className="mt-4 text-[13px] text-ink-faint">Last updated {updated}</p>}

          <div className={`mt-12 border-t border-line pt-10 ${toc ? "lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16" : ""}`}>
            {toc && (
              <>
                <nav aria-label="On this page" className="hidden lg:block">
                  <div className="sticky top-24">
                    <div className="text-[13px] font-medium text-ink-faint">On this page</div>
                    <TocLinks toc={toc} />
                  </div>
                </nav>
                <details className="mb-10 rounded-xl border border-line bg-paper-sunken px-4 py-3 lg:hidden">
                  <summary className="cursor-pointer text-[13px] font-medium text-ink-soft">On this page</summary>
                  <TocLinks toc={toc} />
                </details>
              </>
            )}
            <div className={toc ? "min-w-0" : "max-w-3xl"}>{children}</div>
          </div>

        </div>
      </main>

      <Footer />
    </div>
  );
}

function TocLinks({ toc }) {
  return (
    <ol className="mt-3 space-y-2">
      {toc.map((item) => (
        <li key={item.id}>
          <a href={`#${item.id}`} className="text-[13.5px] leading-snug text-ink-soft transition-colors hover:text-ink">
            {item.label}
          </a>
        </li>
      ))}
    </ol>
  );
}

export default DocPage;
