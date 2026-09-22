import DocPage from "../components/layout/DocPage.jsx";

/* About, Privacy and Terms: one layout over the copy in content/pages.js. A
   paragraph is a string, `{ list }` a bulleted list, `{ link, text }` a sentence
   that links out. */
function TextPage({ page }) {
  return (
    <DocPage
      title={page.title}
      lead={page.lead.map((p) => <p key={p}>{p}</p>)}
      updated={page.updated}
      toc={page.sections.length > 3 ? page.sections.map(({ id, title }) => ({ id, label: title })) : null}
    >
      {page.sections.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-24 border-b border-line py-8 first:pt-0 last:border-b-0">
          <h2 className="text-[1.25rem] font-semibold tracking-[-0.01em] text-ink">{section.title}</h2>
          <div className="mt-3 max-w-3xl space-y-3 text-[14.5px] leading-[1.75] text-ink-soft">
            {section.body.map((block, i) => <Block key={i} block={block} />)}
          </div>
        </section>
      ))}
    </DocPage>
  );
}

function Block({ block }) {
  if (typeof block === "string") return <p>{block}</p>;
  if (block.list) {
    return (
      <ul className="list-disc space-y-2 pl-5 marker:text-ink-faint">
        {block.list.map((item) => <li key={item}>{item}</li>)}
      </ul>
    );
  }
  return (
    <p>
      {block.text}{" "}
      <a href={block.link} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
        {block.link.replace("https://", "")}
      </a>
    </p>
  );
}

export default TextPage;
