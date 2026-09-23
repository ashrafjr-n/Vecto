import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import Header from "../components/layout/Header.jsx";
import Footer from "../components/layout/Footer.jsx";
import SpecRows from "../components/common/SpecRows.jsx";
import {
  METHODOLOGY_INTRO, METHODOLOGY_FACTS, PHASES, PRINCIPLES, AI_MEASURED, LIMITS,
} from "../content/methodology.js";

/* Documentation for the audience that will check the numbers.

   It has its own frame, not About's (2026-09-23, owner). About is an editorial
   masthead — a statement, a colophon beside it, two columns of lead — which is
   right for a page read once, top to bottom. This page is thirteen sections of
   thresholds that people arrive at from a link, scan, and leave: it is laid out
   as documentation, with a contents rail down the left that stays put, the same
   rail the report uses, so the product has one way of showing "where you are in
   a long thing". The stage headers still stick while their rules scroll, and no
   rule is folded — a reference is scanned, and a folded rule cannot be found
   with the browser's own search.

   Content lives in content/methodology.js; this file only lays it out. */

const SECTIONS = [
  ...PHASES.map((phase, i) => ({ id: phase.id, label: phase.title, index: i + 1 })),
  { id: "principles", label: "Trust principles" },
  { id: "ai",         label: "The deeper review, measured" },
  { id: "limits",     label: "What it does not decide" },
];

function Contents({ className = "", vertical }) {
  return (
    <nav aria-label="Contents" className={className}>
      <p className="px-3 pb-2 text-[11px] uppercase tracking-[0.08em] text-ink-faint">Contents</p>
      <ol className={vertical ? "" : "grid gap-x-10 sm:grid-cols-2"}>
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="flex items-baseline gap-2.5 border-l-2 border-transparent px-3 py-1.5 text-[13.5px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
            >
              <span className="w-3 shrink-0 font-mono text-[11px] text-ink-faint">{section.index ?? ""}</span>
              {section.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Methodology() {
  return (
    <div className="night min-h-screen bg-paper text-ink">
      {/* React 19 hoists this into <head> for the life of the page. */}
      <title>Methodology · Vecto</title>
      <Header />

      <main className="px-6 pt-24 pb-24 sm:px-10 sm:pt-28">
        <div className="mx-auto flex max-w-[1280px] gap-12 xl:gap-16">

          <aside className="sticky top-24 hidden w-[232px] shrink-0 self-start lg:block">
            <Contents vertical />
          </aside>

          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink-faint">Reference · Methodology</div>
            <h1 className="mt-5 max-w-[18ch] text-[2rem] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[2.75rem]">
              {METHODOLOGY_INTRO.headline}
            </h1>

            <div className="mt-8 max-w-3xl space-y-5 text-[15.5px] leading-[1.75] text-ink-soft">
              {METHODOLOGY_INTRO.lead.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>

            {/* The same checkable facts About prints as a colophon, set here as one
                strip — a line of data under the lead, not a column beside a title. */}
            <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4 border-y border-line py-4">
              {METHODOLOGY_FACTS.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-[11.5px] text-ink-faint">{fact.label}</dt>
                  <dd className="mt-0.5 font-mono text-[13px] text-ink">{fact.value}</dd>
                </div>
              ))}
              <div>
                <dt className="text-[11.5px] text-ink-faint">Stages</dt>
                <dd className="mt-0.5 font-mono text-[13px] text-ink">{PHASES.length}</dd>
              </div>
            </dl>

            <Contents className="mt-10 lg:hidden" />

            {PHASES.map((phase, i) => (
              <section key={phase.id} id={phase.id} className="scroll-mt-16 pt-14">
                <div className="sticky top-16 z-10 flex items-baseline gap-4 border-b border-line bg-paper/95 py-3 backdrop-blur">
                  <span className="font-mono text-[12px] text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
                  <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink">{phase.title}</h2>
                  <span className="ml-auto shrink-0 text-[12px] text-ink-faint">
                    {phase.points.length} rules
                  </span>
                </div>
                <p className="mt-6 max-w-3xl text-[15px] leading-[1.75] text-ink-soft">{phase.lead}</p>
                <SpecRows className="mt-7" rows={phase.points} />
              </section>
            ))}

            <section id="principles" className="scroll-mt-16 pt-20">
              <h2 className="max-w-[20ch] text-[1.375rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[1.75rem]">
                Why the numbers can be checked, not just believed
              </h2>
              <div className="mt-8 grid gap-x-12 gap-y-8 sm:grid-cols-2">
                {PRINCIPLES.map((principle) => (
                  <div key={principle.title} className="border-t border-line pt-5">
                    <h3 className="text-[15px] font-medium tracking-tight text-ink">{principle.title}</h3>
                    <p className="mt-2.5 text-[13.5px] leading-[1.75] text-ink-soft">{principle.text}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="ai" className="scroll-mt-16 pt-20">
              <h2 className="max-w-[20ch] text-[1.375rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[1.75rem]">
                The deeper review, measured
              </h2>
              <p className="mt-4 max-w-3xl text-[14px] leading-[1.75] text-ink-soft">
                Scored against answers written before the files were ever sent, on files the
                prompts were never tuned on. Nothing below is a rounded or a best figure.
              </p>
              <SpecRows className="mt-8" rows={AI_MEASURED} />
            </section>

            <section id="limits" className="scroll-mt-16 pt-20">
              <h2 className="max-w-[20ch] text-[1.375rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[1.75rem]">
                What the engine does not decide
              </h2>
              <SpecRows className="mt-8" rows={LIMITS} />
            </section>

            <div className="mt-20 flex flex-col gap-6 border-t border-line pt-10 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[15px] text-ink-soft">Read the method, then run it on your own data.</p>
              <Link
                to="/"
                onClick={() => window.scrollTo(0, 0)}
                className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 sm:self-auto"
              >
                Analyze a dataset
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default Methodology;
