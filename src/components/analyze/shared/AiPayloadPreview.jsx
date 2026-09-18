import { useState } from "react";

/* "Show exactly what is sent" — the payload an AI feature is about to send, built
   by the same pure function the request uses, so the preview cannot differ from
   the bytes that leave the browser. Built only when opened: on a large file the
   profile is a full pass over the data.

   It also carries the other half of that fact — what is KEPT — because the two are
   read together and all three AI panels render this component. AiPanel's own footer
   states the count and clears them, but only once an answer exists; this line is
   what a user sees while deciding whether to ask at all. */
function AiPayloadPreview({ build }) {
  const [preview, setPreview] = useState(null);

  return (
    <>
    <details
      className="mt-3 text-[12.5px] text-ink-soft"
      onToggle={(e) => { if (e.currentTarget.open && !preview) setPreview(JSON.stringify(build(), null, 2)); }}
    >
      <summary className="cursor-pointer font-medium hover:text-ink">
        Show exactly what is sent{preview && ` (${(preview.length / 1024).toFixed(1)} KB)`}
      </summary>
      {preview && (
        <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-line bg-paper p-4 font-mono text-[11px] leading-relaxed text-ink-soft">
          {preview}
        </pre>
      )}
    </details>
    {/* Outside <details>: it is read while deciding whether to ask, not after opening
        the payload, so it must not need a click to appear. */}
    <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
      The answer is kept in this browser so the same question costs no second request.
      It is stored only here, never sent anywhere, and you can clear it below.
    </p>
    </>
  );
}

export default AiPayloadPreview;
