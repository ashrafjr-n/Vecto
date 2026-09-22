import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown } from "lucide-react";

import DocPage from "../components/layout/DocPage.jsx";
import { METHODOLOGY_INTRO, PHASES, PRINCIPLES, AI_MEASURED, LIMITS } from "../content/methodology.js";

const TOC = [
  ...PHASES.map((phase) => ({ id: phase.id, label: phase.title })),
  { id: "principles", label: "Why the numbers can be checked" },
  { id: "ai",         label: "The AI review, measured" },
  { id: "limits",     label: "Limits" },
];

/* Documentation for the audience that will check the numbers. Each stage shows
   its title and lead; the rules behind it open on demand, so the page reads as an
   outline first and a reference second. Content lives in content/methodology.js;
   this file only lays it out. */
function Methodology() {
  return (
    <DocPage
      title={METHODOLOGY_INTRO.headline}
      docTitle="Methodology"
      lead={METHODOLOGY_INTRO.lead.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      toc={TOC}
    >
      <p className="text-[13px] font-medium text-ink-faint">{PHASES.length} stages, in the order a report is built</p>

      <div className="mt-4">
        {PHASES.map((phase, i) => (
          <section key={phase.id} id={phase.id} className="scroll-mt-24 border-b border-line py-8 first:pt-2">
            <div className="text-[13px] text-ink-faint">Stage {i + 1}</div>
            <h2 className="mt-1 text-[1.375rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-2xl">{phase.title}</h2>
            <p className="mt-3 max-w-3xl text-[15px] leading-[1.75] text-ink-soft">{phase.lead}</p>
            <details className="group mt-4">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[13.5px] font-medium text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
                {phase.points.length} rules and thresholds
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
              </summary>
              <dl className="mt-4 border-t border-line">
                {phase.points.map((point) => (
                  <div key={point.label} className="border-b border-line py-4 last:border-b-0">
                    <dt className="text-[14.5px] font-medium tracking-tight text-ink">{point.label}</dt>
                    <dd className="mt-1.5 max-w-3xl text-[13.5px] leading-[1.75] text-ink-soft">{point.text}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </section>
        ))}
      </div>

      <DocSection id="principles" title="Why the numbers can be checked, not just believed">
        <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
          {PRINCIPLES.map((principle) => (
            <div key={principle.title}>
              <h3 className="text-[15px] font-medium tracking-tight text-ink">{principle.title}</h3>
              <p className="mt-2 text-[13.5px] leading-[1.75] text-ink-soft">{principle.text}</p>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection
        id="ai"
        title="The AI review, measured"
        lead="Scored against answers written before the files were ever sent, on files the prompts were never tuned on. Nothing below is a rounded or a best figure."
      >
        <TitledRows rows={AI_MEASURED} />
      </DocSection>

      <DocSection id="limits" title="What the engine does not decide">
        <TitledRows rows={LIMITS} />
      </DocSection>

      <div className="mt-16 flex flex-col gap-6 border-t border-line pt-10 sm:flex-row sm:items-center sm:justify-between">
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
    </DocPage>
  );
}

function DocSection({ id, title, lead, children }) {
  return (
    <section id={id} className="mt-16 scroll-mt-24">
      <h2 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-2xl">{title}</h2>
      {lead && <p className="mt-3 max-w-3xl text-[14px] leading-[1.75] text-ink-soft">{lead}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function TitledRows({ rows }) {
  return (
    <dl className="border-t border-line">
      {rows.map((row) => (
        <div key={row.title} className="border-b border-line py-4">
          <dt className="text-[14.5px] font-medium tracking-tight text-ink">{row.title}</dt>
          <dd className="mt-1.5 max-w-3xl text-[13.5px] leading-[1.7] text-ink-soft">{row.text}</dd>
        </div>
      ))}
    </dl>
  );
}

export default Methodology;
