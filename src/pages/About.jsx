import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import ReferencePage from "../components/layout/ReferencePage.jsx";
import SpecRows from "../components/common/SpecRows.jsx";
import { ABOUT } from "../content/pages.js";

/* The page is the opposition: what the tool does, set directly against what it
   refuses to do, in two columns that share one rule — most of what people get
   wrong about a data tool is the second column. Copy lives in content/pages.js. */
function About() {
  return (
    <ReferencePage
      kicker={ABOUT.kicker}
      docTitle="About"
      title={ABOUT.title}
      facts={ABOUT.facts}
      lead={ABOUT.lead.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
    >
      <div className="mt-16 grid gap-x-16 gap-y-12 border-t border-line pt-10 lg:grid-cols-2">
        {[ABOUT.does, ABOUT.isNot].map((column) => (
          <section key={column.title}>
            <h2 className="text-[1.25rem] font-semibold tracking-[-0.02em] text-ink">{column.title}</h2>
            <dl className="mt-6 border-t border-line">
              {column.rows.map((row) => (
                <div key={row.label} className="border-b border-line py-4">
                  <dt className="text-[14px] font-medium tracking-tight text-ink">{row.label}</dt>
                  <dd className="mt-1.5 text-[13.5px] leading-[1.75] text-ink-soft">{row.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <section className="mt-20">
        <h2 className="text-[1.25rem] font-semibold tracking-[-0.02em] text-ink">{ABOUT.built.title}</h2>
        <SpecRows className="mt-6" rows={ABOUT.built.rows} />
      </section>

      <div className="mt-16 flex flex-col gap-6 border-t border-line pt-10 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-[15px] leading-relaxed text-ink-soft">
          {ABOUT.source.text}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={ABOUT.source.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-line-strong px-5 py-2.5 text-[13px] font-semibold text-ink transition-colors hover:border-ink-faint"
          >
            GitHub
            <ArrowUpRight size={14} />
          </a>
          <Link
            to="/"
            onClick={() => window.scrollTo(0, 0)}
            className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
          >
            Analyze a dataset
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </ReferencePage>
  );
}

export default About;
