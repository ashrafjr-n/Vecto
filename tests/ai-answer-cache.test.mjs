/* ai-answer-cache.test.mjs — plain Node, no framework (same style as the other suites).

   Locks the behaviour requestAi depends on: the same task and payload hit, anything
   different misses, only successes are stored, the oldest entry goes first, and no
   failure of localStorage can throw into the caller. localStorage does not exist in
   Node, so it is stubbed here — which is also how the private-window case is tested. */

let failures = 0;
function check(name, ok) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

/* A localStorage that behaves like a browser's: one string store, and a `fail` switch
   for the private-window / quota-exceeded case. */
function stubStorage({ fail = false } = {}) {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => { if (fail) throw new Error("storage disabled"); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (fail) throw new Error("quota exceeded"); map.set(k, String(v)); },
    removeItem: (k) => { if (fail) throw new Error("storage disabled"); map.delete(k); },
  };
  return map;
}

stubStorage();
const { readCached, writeCached, cachedCount, clearCache } = await import("../src/lib/ai/answerCache.js");

const payload = { columns: [{ name: "age", role: "numeric" }] };

// --- the hit, and what must not hit ---

clearCache();
check("an answer never given is a miss", (await readCached("review", payload)) === null);

await writeCached("review", payload, { result: { ok: 1 }, model: "m/one" });
const hit = await readCached("review", payload);
check("the same task and payload hit", hit?.result.ok === 1 && hit.model === "m/one");

// A deep copy: the key is the payload's content, not its identity.
check("an identical payload built again hits", (await readCached("review", JSON.parse(JSON.stringify(payload)))) !== null);

check("a different task misses", (await readCached("leakage", payload)) === null);
check("one changed value misses", (await readCached("review", { columns: [{ name: "age", role: "binary" }] })) === null);
check("one extra column misses", (await readCached("review", { columns: [...payload.columns, { name: "fare" }] })) === null);

// --- eviction: 20 entries, oldest out first ---

clearCache();
for (let i = 0; i < 25; i++) await writeCached("review", { n: i }, { result: i, model: "m" });
check("the store is capped at 20 entries", cachedCount() === 20);
check("the oldest entry was evicted", (await readCached("review", { n: 0 })) === null);
check("the newest entry survived", (await readCached("review", { n: 24 }))?.result === 24);

// --- storage that refuses: a miss, never a throw ---

clearCache();
await writeCached("review", payload, { result: { ok: 1 }, model: "m/one" });
stubStorage({ fail: true });
let threw = false;
try {
  check("unreadable storage is a miss", (await readCached("review", payload)) === null);
  await writeCached("review", payload, { result: { ok: 2 }, model: "m/two" });
  check("unwritable storage does not throw", true);
  check("counting unreadable storage is 0", cachedCount() === 0);
  clearCache();
} catch {
  threw = true;
}
check("no storage failure reaches the caller", threw === false);

// --- no crypto.subtle (an insecure context): every call is a miss, nothing throws ---

stubStorage();
// In Node `crypto` is a getter-only global, so it is redefined rather than assigned.
const realCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
clearCache();
await writeCached("review", payload, { result: { ok: 1 }, model: "m/one" });
check("without crypto.subtle nothing is stored", cachedCount() === 0);
check("without crypto.subtle every read is a miss", (await readCached("review", payload)) === null);
Object.defineProperty(globalThis, "crypto", realCrypto);

// --- through requestAi: the acceptance criterion, that a repeat costs no request ---

stubStorage();
const { requestAi } = await import("../src/lib/ai/requestAi.js");

let calls = 0;
const serve = (status, body) => {
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify(body), { status }); };
};

clearCache();
serve(200, { task: "review", model: "m/one", result: { columns: [] } });
const first = await requestAi("review", payload);
check("the first ask reaches the endpoint", calls === 1 && first.result !== null && first.cached === false);

const second = await requestAi("review", payload);
check("the same ask again spends no request", calls === 1);
check("and answers from the cache", second.cached === true && second.model === "m/one");

await requestAi("review", { columns: [] });
check("a different file still asks", calls === 2);

// A failure must never be stored: the next ask has to be able to succeed.
clearCache();
serve(502, { error: "upstream_error" });
const failed = await requestAi("leakage", payload);
check("an endpoint error is returned, not thrown", failed.error !== null && failed.result === null);
check("an error is not cached", cachedCount() === 0);

clearCache();

console.log(failures === 0 ? "\nall answer-cache checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
