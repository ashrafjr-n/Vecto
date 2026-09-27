import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";

import { listSavedReports, deleteSavedReport, clearSavedReports } from "../../lib/savedReports.js";

/* The reports saved in this browser (lib/savedReports.js), newest first. Rendered
   only when there is at least one, so a first visit sees nothing new.

   Compact on purpose: it sits in the home page's pinned, one-screen upload panel
   (overflow hidden), so it shows the SHOWN newest on one line each rather than
   growing past the bottom of a phone screen. Deleting one brings the next up. */
const SHOWN = 3;

const VERDICT = {
  blocked: { label: "Not ready", cls: "text-critical" },
  fix:     { label: "Ready after fixes", cls: "text-warning" },
  ready:   { label: "Ready", cls: "text-success" },
};

function RecentReports() {
  const [reports, setReports] = useState([]);

  useEffect(() => {
    let live = true;
    listSavedReports().then((list) => { if (live) setReports(list); });
    return () => { live = false; };
  }, []);

  if (reports.length === 0) return null;

  const remove = async (id) => {
    await deleteSavedReport(id);
    setReports((list) => list.filter((r) => r.id !== id));
  };
  const clearAll = async () => {
    await clearSavedReports();
    setReports([]);
  };

  const shown = reports.slice(0, SHOWN);
  return (
    <section className="mt-5 rounded-2xl border border-line bg-paper-sunken px-4 py-3 text-left">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[12.5px] font-semibold tracking-tight text-ink">Recent reports</h2>
        <span className="text-[11.5px] text-ink-faint">
          saved in this browser only{reports.length > SHOWN ? ` · newest ${SHOWN} of ${reports.length}` : ""}
        </span>
        <span className="h-px min-w-4 flex-1 bg-line" />
        <button type="button" onClick={clearAll} className="text-[11.5px] text-ink-faint underline-offset-2 hover:text-ink hover:underline">
          Delete all
        </button>
      </div>
      <ul>
        {shown.map((r) => {
          const verdict = VERDICT[r.verdict];
          return (
            <li key={r.id} className="flex items-center gap-2">
              <Link
                to={`/analyze?report=${encodeURIComponent(r.id)}`}
                className="group flex min-w-0 flex-1 items-baseline gap-2 py-1 text-[12px]"
                title={`${r.rows.toLocaleString()} rows × ${r.columns} columns · ${new Date(r.savedAt).toLocaleString()}`}
              >
                <span className="truncate font-mono text-ink group-hover:underline">{r.fileName ?? "Untitled file"}</span>
                <span className="hidden shrink-0 text-ink-faint sm:inline">{r.target ? `→ ${r.target}` : "no target"}</span>
                <span className="shrink-0 text-ink-faint">{new Date(r.savedAt).toLocaleDateString()}</span>
                {verdict && <span className={`shrink-0 ${verdict.cls}`}>{verdict.label}</span>}
              </Link>
              <button
                type="button"
                onClick={() => remove(r.id)}
                aria-label={`Delete the saved report for ${r.fileName ?? "this file"}`}
                className="rounded-md p-1 text-ink-faint transition-colors hover:bg-paper hover:text-critical"
              >
                <Trash2 size={12} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default RecentReports;
