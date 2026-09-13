import Header from "../components/layout/Header.jsx";
import Footer from "../components/layout/Footer.jsx";
import SectionLabel from "../components/common/SectionLabel.jsx";
import { METHODOLOGY_INTRO } from "../content/methodology.js";

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

      </main>

      <Footer />
    </div>
  );
}

export default Methodology;
