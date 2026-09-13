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

        {/* ── CONTENT PANEL — mirrored radii, interlocking with the hero ── */}
        <section className="rounded-t-[2.5rem] bg-paper-sunken px-6 pt-20 pb-24 sm:rounded-t-[4.5rem] sm:px-10 sm:pt-28 sm:pb-32 lg:rounded-t-[7rem]">
          <div className="mx-auto max-w-[1400px]">

            <SectionLabel mark="02">The analysis, stage by stage</SectionLabel>
            <h2 className="mt-10 max-w-[24ch] text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl">
              Eight stages, in the order a report is built.
            </h2>

            <div className="mt-16">
              {PHASES.map((phase, i) => (
                <article
                  key={phase.id}
                  id={phase.id}
                  className="grid scroll-mt-24 gap-x-16 gap-y-8 border-t border-line py-12 sm:py-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
                >
                  <div>
                    <div className="font-mono text-[11px] text-ink-faint">{index2(i)}</div>
                    <h3 className="mt-4 text-[1.5rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-3xl">
                      {phase.title}
                    </h3>
                    <p className="mt-5 max-w-xl text-[15px] leading-[1.75] text-ink-soft">{phase.lead}</p>
                  </div>
                  <dl className="border-t border-line lg:border-t-0">
                    {phase.points.map((point) => (
                      <div key={point.label} className="border-b border-line py-5 first:pt-5 lg:first:pt-0">
                        <dt className="text-[15px] font-medium tracking-tight text-ink">{point.label}</dt>
                        <dd className="mt-1.5 text-[13.5px] leading-[1.75] text-ink-soft">{point.text}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>

          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}

export default Methodology;
