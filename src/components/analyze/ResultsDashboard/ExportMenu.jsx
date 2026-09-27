import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";

import { reportModel, toMarkdown, toHtml, toJson, dataDictionaryCsv, exportStem } from "../../../lib/export/report.js";

/* The report as files: a page to read or print, Markdown for a README or a ticket,
   JSON for tools, and a data dictionary. Built in the browser on click — nothing is
   uploaded — and none of them carries the rows (lib/export/report.js). */

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const FORMATS = [
  { id: "html", label: "Report (HTML)",           hint: "Opens in any browser; prints to PDF" },
  { id: "md",   label: "Report (Markdown)",       hint: "For a README, an issue or notes" },
  { id: "json", label: "Full results (JSON)",     hint: "Every figure, for your own tools" },
  { id: "csv",  label: "Data dictionary (CSV)",   hint: "One row per column" },
];

function ExportMenu({ result, source }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  const exportAs = (id) => {
    setOpen(false);
    const fileName = source?.fileName ?? null;
    const stem = exportStem(fileName);
    const at = { fileName, generatedAt: new Date() };
    if (id === "html") download(`${stem}.html`, toHtml(reportModel(result, at)), "text/html");
    if (id === "md")   download(`${stem}.md`, toMarkdown(reportModel(result, at)), "text/markdown");
    if (id === "json") download(`${stem}.json`, toJson(result, at), "application/json");
    if (id === "csv")  download(`${stem}-dictionary.csv`, dataDictionaryCsv(result, source?.rows), "text/csv");
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong px-3.5 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-accent-tint"
      >
        <Download size={13} className="shrink-0" />
        <span className="hidden sm:inline">Export</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-line bg-paper-sunken p-1.5 shadow-xl">
          {FORMATS.filter((f) => f.id !== "csv" || source?.rows).map((f) => (
            <button
              key={f.id}
              type="button"
              role="menuitem"
              onClick={() => exportAs(f.id)}
              className="block w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent-tint"
            >
              <div className="text-[13px] font-medium text-ink">{f.label}</div>
              <div className="text-[11.5px] text-ink-faint">{f.hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ExportMenu;
