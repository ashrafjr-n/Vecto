import { useState } from "react";

/* What an AI feature sends, in two layers: one short line that is always visible
   (`sent` — what leaves, where it goes, that free models may log it), and on demand
   the exact payload, built by the same pure function the request uses so the
   preview cannot differ from the bytes that leave the browser. Built only when
   opened: on a large file the profile is a full pass over the data.

   The full account — what each task sends, the answer cache, the providers — lives on
   /privacy; this is the version a user reads while deciding whether to ask. */
function AiPayloadPreview({ build, sent }) {
  const [preview, setPreview] = useState(null);

  return (
    <>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-faint">{sent}</p>
      <details
        className="mt-2 text-[12.5px] text-ink-soft"
        onToggle={(e) => { if (e.currentTarget.open && !preview) setPreview(JSON.stringify(build(), null, 2)); }}
      >
        <summary className="cursor-pointer font-medium hover:text-ink">
          See exactly what is sent{preview && ` (${(preview.length / 1024).toFixed(1)} KB)`}
        </summary>
        {preview && (
          <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-line bg-paper p-4 font-mono text-[11px] leading-relaxed text-ink-soft">
            {preview}
          </pre>
        )}
        <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
          Answers are kept in this browser, so asking the same question again costs nothing.
          They never leave it, and you can clear them once an answer is shown.
        </p>
      </details>
    </>
  );
}

export default AiPayloadPreview;
