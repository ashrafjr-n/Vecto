import Header from "../components/layout/Header.jsx";
import Footer from "../components/layout/Footer.jsx";
import SectionLabel from "../components/common/SectionLabel.jsx";
import { METHODOLOGY_INTRO, PHASES } from "../content/methodology.js";

const index2 = (i) => String(i + 1).padStart(2, "0");

/* Documentation for the audience that will check the numbers. Same dark
   editorial language as Home: a hero panel curving away at the bottom, the
   dotted canvas in the gap, a content panel with the mirrored radius. Content
   lives in content/methodology.js; this file only lays it out. */
function Methodology() {
  return (
    <div className="night dot-grid min-h-screen bg-paper text-ink">
      {/* React 19 hoists this into <head> for the life of the page. */}
      <title>Methodology · Vecto</title>
      <Header />

      <main>

        <section className="rounded-b-[2.5rem] bg-paper-sunken px-6 pt-28 pb-20 sm:rounded-b-[4.5rem] sm:px-10 sm:pt-36 sm:pb-28 lg:rounded-b-[7rem]">
          <div className="mx-auto max-w-[1400px]">
            <SectionLabel mark="01">Methodology</SectionLabel>

            <h1 className="mt-12 max-w-[19ch] text-[2.5rem] font-semibold leading-[1.03] tracking-[-0.035em] text-ink sm:text-6xl lg:text-[5.25rem]">
              {METHODOLOGY_INTRO.headline}
            </h1>

            <div className="mt-16 grid gap-x-16 gap-y-10 border-t border-line pt-12 lg:grid-cols-2">
              {METHODOLOGY_INTRO.lead.map((paragraph) => (
                <p key={paragraph} className="max-w-2xl text-[16px] leading-[1.7] text-ink-soft">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
        </section>

        {/* ── DOTTED CANVAS — the index of stages. Plain anchors: each link jumps
            to the stage below, and the URL hash makes a stage shareable. ── */}
        <section className="px-6 py-20 sm:px-10 sm:py-28">
          <nav aria-label="Analysis stages" className="mx-auto max-w-[1400px] rounded-[2rem] border border-line-strong bg-paper-sunken px-6 py-8 sm:px-10 sm:py-10">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-faint">
              {PHASES.length} stages, in order
            </div>
            <ol className="mt-6 grid grid-cols-1 gap-x-10 sm:grid-cols-2 lg:grid-cols-4">
              {PHASES.map((phase, i) => (
                <li key={phase.id} className="border-t border-line">
                  <a
                    href={`#${phase.id}`}
                    className="flex items-baseline gap-4 py-4 text-[15px] tracking-tight text-ink-soft transition-colors hover:text-ink"
                  >
                    <span className="font-mono text-[11px] text-ink-faint">{index2(i)}</span>
                    {phase.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </section>

      </main>

      <Footer />
    </div>
  );
}

export default Methodology;
