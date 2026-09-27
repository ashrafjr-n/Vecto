import { useRef, useState } from "react";
import Papa from "papaparse";
import { ArrowLeftRight, CircleX, Info, LoaderCircle, TriangleAlert } from "lucide-react";

import SectionCard from "../../shared/SectionCard.jsx";
import StatusBadge from "../../shared/StatusBadge.jsx";
import { decodeCsv, validateFile, inspectParseResult, transformHeader, ACCEPTED_EXTENSIONS } from "../../../../lib/csvIntake.js";
import { runComparison } from "../../../../lib/runComparison.js";

/* Train vs test: a second file checked against the one this report was built on
   (lib/compare.js). Read in the browser exactly like the first file. The state lives
   in ResultsDashboard, so switching sections does not throw the comparison away. */

const VERDICT = {
  blocked: { severity: "critical", label: "Not a fair test",   text: "The test file shares rows or records with training, or cannot be scored by a model trained on it. A score on it would mislead." },
  fix:     { severity: "warning",  label: "Usable, with care", text: "The test file can be scored, but differs from training in ways that will move the score. Read the findings before trusting a number." },
  ready:   { severity: "success",  label: "A fair test",       text: "No overlap with training and no shift large enough to matter." },
};
const LEVEL = {
  blocker: { icon: CircleX,       cls: "text-critical" },
  fix:     { icon: TriangleAlert, cls: "text-warning" },
  note:    { icon: Info,          cls: "text-ink-faint" },
};
const SHIFT = { major: "text-critical", moderate: "text-warning", stable: "text-success" };
const pctText = (x) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(x < 0.1 && x > 0 ? 1 : 0)}%`);
const day = (t) => new Date(t).toISOString().slice(0, 10);

function Picker({ onFile, busy, error, again }) {
  const input = useRef(null);
  return (
    <SectionCard title={again ? null : "Compare with a test file"}>
      {!again && (
        <p className="mb-4 max-w-3xl text-[13px] leading-relaxed text-ink-soft">
          Add the file you will test on — a held-out split, new data, or a later extract. Vecto checks it against this
          one: rows or records on both sides (leakage), columns the model needs that it lacks, and how far the target and
          each feature have moved. It is read in this browser, like the first file.
        </p>
      )}
      <input ref={input} type="file" accept={ACCEPTED_EXTENSIONS.join(",")} className="hidden"
        onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) onFile(f); }} />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy ? <LoaderCircle size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
        {busy ? "Comparing…" : again ? "Compare another file" : "Choose the test file"}
      </button>
      {error && <p className="mt-3 text-[12.5px] text-critical">{error}</p>}
    </SectionCard>
  );
}

function Findings({ comparison, fileName }) {
  const verdict = VERDICT[comparison.verdict];
  return (
    <SectionCard title={`Is ${fileName ? `"${fileName}"` : "this file"} a fair test?`} action={<StatusBadge severity={verdict.severity}>{verdict.label}</StatusBadge>}>
      <p className="text-[13.5px] leading-relaxed text-ink-soft">{verdict.text}</p>
      {comparison.items.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {comparison.items.map((item, i) => {
            const { icon: Icon, cls } = LEVEL[item.level];
            return (
              <li key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <Icon size={15} className={`mt-0.5 shrink-0 ${cls}`} />
                <div>
                  <div className="text-[13.5px] font-medium text-ink">{item.title}</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{item.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function Facts({ comparison }) {
  const { rows, schema, overlap, dates } = comparison;
  const facts = [
    ["Rows", `${rows.train.toLocaleString()} train · ${rows.test.toLocaleString()} test`],
    ["Shared columns", String(schema.shared)],
    ["Only in train", schema.onlyTrain.length ? schema.onlyTrain.join(", ") : "none"],
    ["Only in test", schema.onlyTest.length ? schema.onlyTest.join(", ") : "none"],
    ["Rows in both files", `${overlap.rows.toLocaleString()} (${pctText(overlap.share)} of test)`],
    ...comparison.entities.map((e) => [`"${e.col}" values also in train`, `${e.inTrain.toLocaleString()} of ${e.testRows.toLocaleString()} test rows`]),
    ...(dates ? [[`"${dates.column}"`, `train ${day(dates.train.from)} – ${day(dates.train.to)} · test ${day(dates.test.from)} – ${day(dates.test.to)}`]] : []),
  ];
  return (
    <SectionCard title="The two files">
      <dl className="divide-y divide-line">
        {facts.map(([k, v]) => (
          <div key={k} className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2 first:pt-0 last:pb-0">
            <dt className="text-[12.5px] text-ink-soft">{k}</dt>
            <dd className="break-all font-mono text-[12px] text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}

function TargetShift({ target, name }) {
  if (!target?.labelled) return null;
  return (
    <SectionCard title={`"${name}" in each file`} action={<span className={`font-mono text-[12px] ${SHIFT[target.level]}`}>PSI {target.psi.toFixed(2)} · {target.level}</span>}>
      {target.kind === "classes" ? (
        <table className="w-full text-[12.5px]">
          <thead><tr className="text-left text-ink-faint"><th className="pb-2 font-normal">Class</th><th className="pb-2 text-right font-normal">Train</th><th className="pb-2 text-right font-normal">Test</th></tr></thead>
          <tbody className="divide-y divide-line">
            {target.classes.map((c) => (
              <tr key={c.value}><td className="py-1.5 font-mono text-ink">{c.value}</td><td className="py-1.5 text-right font-mono">{pctText(c.train)}</td><td className="py-1.5 text-right font-mono">{pctText(c.test)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-[13px] text-ink-soft">Average {Number(target.trainMean.toPrecision(4)).toLocaleString()} in train, {Number(target.testMean.toPrecision(4)).toLocaleString()} in test (KS {target.ks?.toFixed(2)}).</p>
      )}
    </SectionCard>
  );
}

function FeatureShift({ features }) {
  if (!features.length) return null;
  return (
    <SectionCard title="Each feature, train against test">
      <p className="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-faint">
        PSI under 0.1 is stable, 0.1–0.25 has moved, 0.25 and over is a different distribution — after subtracting
        what two samples of this size differ by from chance alone. Only the columns the preparation plan feeds a model
        are compared.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[12.5px]">
          <thead>
            <tr className="text-left text-ink-faint">
              <th className="pb-2 font-normal">Column</th><th className="pb-2 text-right font-normal">PSI</th>
              <th className="pb-2 text-right font-normal">KS / new categories</th><th className="pb-2 text-right font-normal">Missing train → test</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {features.map((f) => (
              <tr key={f.col}>
                <td className="py-1.5 font-mono text-ink">{f.col}</td>
                <td className={`py-1.5 text-right font-mono ${SHIFT[f.level]}`}>{f.psi.toFixed(2)}</td>
                <td className="py-1.5 text-right font-mono text-ink-soft">{f.kind === "numeric" ? (f.ks ?? 0).toFixed(2) : pctText(f.unseenShare)}</td>
                <td className={`py-1.5 text-right font-mono ${f.missingShift ? "text-warning" : "text-ink-soft"}`}>{pctText(f.missingTrain)} → {pctText(f.missingTest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function CompareTab({ result, rows, state, onState }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const trainColumns = Object.keys(result.meta.columnRoles);

  const onFile = (file) => {
    const invalid = validateFile(file);
    if (invalid) { setError(invalid === "size" ? "The file is over the size limit." : "Choose a .csv, .tsv or .txt file."); return; }
    setBusy(true);
    setError(null);
    file.arrayBuffer().then((bytes) => {
      const { text } = decodeCsv(bytes);
      Papa.parse(text, {
        header: true, skipEmptyLines: true, transformHeader,
        complete: (parsed) => {
          if (inspectParseResult(parsed).error) { setBusy(false); setError("The file could not be read as a table."); return; }
          runComparison({ rows, columns: trainColumns }, { rows: parsed.data, columns: parsed.meta.fields }, result)
            .then(({ comparison, error: failed }) => {
              setBusy(false);
              if (failed) { setError(`The comparison failed: ${failed}`); return; }
              onState({ fileName: file.name, comparison });
            });
        },
      });
    }, () => { setBusy(false); setError("The file could not be read."); });
  };

  if (!state) return <div className="space-y-4"><Picker onFile={onFile} busy={busy} error={error} /></div>;
  const { comparison, fileName } = state;
  return (
    <div className="space-y-4">
      <Findings comparison={comparison} fileName={fileName} />
      <Facts comparison={comparison} />
      <TargetShift target={comparison.target} name={result.meta.target} />
      <FeatureShift features={comparison.features} />
      <Picker onFile={onFile} busy={busy} error={error} again />
    </div>
  );
}

export default CompareTab;
