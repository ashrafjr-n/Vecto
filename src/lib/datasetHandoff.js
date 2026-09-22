/* Home -> Analyze handoff for a freshly-parsed CSV.
   NOT router state: history.pushState structured-clones its state payload into
   session history, and browsers cap that (roughly 640KB-2MB) — a parsed CSV near
   our 40MB upload limit can blow past it and throw. A plain module variable has
   no such cap, and a hard refresh re-executes this module, so `pending` is `null`
   again for free — the exact fallback /analyze needs with no prior upload. */
let pending = null;

/* `encoding` is what decodeCsv read the bytes as — shown on the target step when it
   was not UTF-8, because the fallback is a guess the user can check and we cannot. */
export function setPendingDataset(data, columns, encoding = "utf-8") {
  pending = { data, columns, encoding };
}

/* Non-destructive on purpose: React 19 StrictMode double-invokes a lazy useState
   initializer in dev, so a read-and-clear here would make the second invocation
   see null and break in dev only. Left set until the next real upload overwrites
   it, or a reload wipes it. */
export function getPendingDataset() {
  return pending;
}
