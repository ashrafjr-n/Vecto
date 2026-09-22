import Header from "./Header.jsx";
import Footer from "./Footer.jsx";

/* The frame Methodology and About share. Not a documentation template — a
   masthead: the statement on the left, a colophon of checkable facts on the
   right, the lead set in two columns under a rule, and then whatever ledger the
   page lays out. The facts are the point of the right half: a reference page
   that opens with an empty column beside its title reads as filler, and these
   are the same kind of figure the report itself prints. Privacy and Terms keep
   DocPage — they are legal text and an index is genuinely useful there. */
function ReferencePage({ kicker, docTitle, title, lead, facts, children }) {
  return (
    <div className="night min-h-screen bg-paper text-ink">
      {/* React 19 hoists this into <head> for the life of the page. */}
      <title>{`${docTitle} · Vecto`}</title>
      <Header />

      <main className="px-6 pt-24 pb-24 sm:px-10 sm:pt-28">
        <div className="mx-auto max-w-[1200px]">

          <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:items-end">
            <div>
              <div className="text-[13px] font-medium text-ink-faint">{kicker}</div>
              <h1 className="mt-6 max-w-[17ch] text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[3.25rem]">
                {title}
              </h1>
            </div>

            {facts && (
              <dl className="border-t border-line">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex items-baseline justify-between gap-6 border-b border-line py-3">
                    <dt className="text-[13px] text-ink-soft">{fact.label}</dt>
                    <dd className="text-right font-mono text-[13px] text-ink">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {lead && (
            <div className="mt-14 grid gap-x-16 gap-y-5 border-t border-line pt-10 text-[15.5px] leading-[1.75] text-ink-soft lg:grid-cols-2">
              {lead}
            </div>
          )}

          {children}

        </div>
      </main>

      <Footer />
    </div>
  );
}

export default ReferencePage;
