import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import ReferencePage from "../components/layout/ReferencePage.jsx";
import SpecRows from "../components/common/SpecRows.jsx";
import {
  METHODOLOGY_INTRO, METHODOLOGY_FACTS, PHASES, PRINCIPLES, AI_MEASURED, LIMITS,
} from "../content/methodology.js";

/* Documentation for the audience that will check the numbers, laid out as the
   specification it is: a contents table at the top, then every stage's rules
   open on the page — a reference is read by scanning, and a rule folded behind a
   summary cannot be scanned or found with the browser's own search. What keeps
   that length navigable is the stage header, which sticks under the site header
   while its own rules scroll past, so the stage you are reading is always named.
   Content lives in content/methodology.js; this file only lays it out. */
function Methodology() {
  return (
    <ReferencePage
      kicker="Reference"
      docTitle="Methodology"
      title={METHODOLOGY_INTRO.headline}
      facts={METHODOLOGY_FACTS}
      lead={METHODOLOGY_INTRO.lead.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
    >
      <nav aria-label="Stages" className="mt-16 border-t border-line pt-8">
        <div className="text-[13px] text-ink-faint">
          {PHASES.length} stages, in the order a report is built
        </div>
        <ol className="mt-5 grid gap-x-12 sm:grid-cols-2 lg:grid-cols-3">
          {PHASES.map((phase, i) => (
            <li key={phase.id} className="border-b border-line">
              <a
                href={`#${phase.id}`}
                className="flex items-baseline gap-3 py-2.5 text-[14px] text-ink-soft transition-colors hover:text-ink"
              >
                <span className="w-4 shrink-0 text-[12px] text-ink-faint">{i + 1}</span>
                {phase.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {PHASES.map((phase, i) => (
        <section key={phase.id} id={phase.id} className="scroll-mt-16 pt-14">
          <div className="sticky top-16 z-10 flex items-baseline gap-4 border-b border-line bg-paper/95 py-3 backdrop-blur">
            <span className="text-[12px] text-ink-faint">Stage {i + 1}</span>
            <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink">{phase.title}</h2>
            <span className="ml-auto shrink-0 text-[12px] text-ink-faint">
              {phase.points.length} rules
            </span>
          </div>
          <p className="mt-6 max-w-3xl text-[15px] leading-[1.75] text-ink-soft">{phase.lead}</p>
          <SpecRows className="mt-7" rows={phase.points} />
        </section>
      ))}

      <section id="principles" className="scroll-mt-24 pt-20">
        <h2 className="max-w-[20ch] text-[1.5rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2rem]">
          Why the numbers can be checked, not just believed
        </h2>
        <div className="mt-10 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((principle) => (
            <div key={principle.title} className="border-t border-line pt-5">
              <h3 className="text-[15px] font-medium tracking-tight text-ink">{principle.title}</h3>
              <p className="mt-2.5 text-[13.5px] leading-[1.75] text-ink-soft">{principle.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="ai" className="scroll-mt-24 pt-20">
        <div className="grid gap-x-16 gap-y-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-end">
          <h2 className="max-w-[16ch] text-[1.5rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2rem]">
            The deeper review, measured
          </h2>
          <p className="text-[14px] leading-[1.75] text-ink-soft">
            Scored against answers written before the files were ever sent, on files the
            prompts were never tuned on. Nothing below is a rounded or a best figure.
          </p>
        </div>
        <SpecRows className="mt-10" rows={AI_MEASURED} />
      </section>

      <section id="limits" className="scroll-mt-24 pt-20">
        <h2 className="max-w-[20ch] text-[1.5rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2rem]">
          What the engine does not decide
        </h2>
        <SpecRows className="mt-10" rows={LIMITS} />
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
    </ReferencePage>
  );
}

export default Methodology;
