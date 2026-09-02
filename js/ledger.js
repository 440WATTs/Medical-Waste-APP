// MedWaste AI — append-only, hash-chained event ledger
//
// Records are never edited. A correction is a new event that supersedes an
// earlier one, and both survive — that is what makes the log auditable
// rather than merely stored.
//
// Each record carries the SHA-256 of the previous record, so any retro-
// active edit breaks the chain from that point forward and `verify()`
// says exactly where. This is a hash chain, not a blockchain: no consensus,
// no network, no coin. It is the honest version of the same guarantee.
//
// Local storage here is a cache plus an outbox. The server is the record of
// truth; the outbox is what survives ward Wi-Fi dropping mid-round.

const Ledger = (() => {
  const KEY_EVENTS = "medwaste.ledger.v1";
  const KEY_OUTBOX = "medwaste.outbox.v1";
  const GENESIS = "0".repeat(64);

  // ---- Storage, guarded -------------------------------------------------
  // The old app wrote base64 JPEGs straight into localStorage against a
  // ~5 MB quota with no try/catch, and threw after roughly 40 scans. Images
  // now live as references; every write is guarded and degrades to
  // in-memory rather than losing the user's work.
  let memoryFallback = null;

  function read(key) {
    if (memoryFallback) return memoryFallback[key] || [];
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  }

  function write(key, value) {
    if (memoryFallback) { memoryFallback[key] = value; return { ok: true, degraded: true }; }
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return { ok: true };
    } catch (err) {
      // Quota exceeded or storage disabled. Keep going in memory and tell
      // the caller, rather than throwing away the event.
      memoryFallback = { [KEY_EVENTS]: read(KEY_EVENTS), [KEY_OUTBOX]: read(KEY_OUTBOX) };
      memoryFallback[key] = value;
      return { ok: true, degraded: true, reason: err.name };
    }
  }

  // ---- Hashing ----------------------------------------------------------
  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Fields that are hashed, in a fixed order. Adding a field later must not
  // silently invalidate old records, so the hashed payload is explicit.
  const canonical = (e) => JSON.stringify([
    e.seq, e.type, e.ts, e.actor, e.bagId ?? null, e.payload, e.prevHash
  ]);

  // ---- Append -----------------------------------------------------------
  async function append(type, payload, opts = {}) {
    const events = read(KEY_EVENTS);
    const prev = events[events.length - 1];
    const event = {
      seq: events.length,
      type,
      ts: opts.ts || Date.now(),
      actor: opts.actor || Session.actor(),
      bagId: opts.bagId || null,
      payload,
      prevHash: prev ? prev.hash : GENESIS
    };
    event.hash = await sha256(canonical(event));

    events.push(event);
    const res = write(KEY_EVENTS, events);

    // Everything that must reach the server goes through the outbox, so a
    // dropped connection queues rather than loses.
    const outbox = read(KEY_OUTBOX);
    outbox.push({ seq: event.seq, hash: event.hash, tries: 0 });
    write(KEY_OUTBOX, outbox);

    return { event, degraded: !!res.degraded };
  }

  // ---- Query ------------------------------------------------------------
  const all = () => read(KEY_EVENTS);

  const byType = (type) => all().filter((e) => e.type === type);

  function forBag(bagId) {
    return all().filter((e) => e.bagId === bagId).sort((a, b) => a.seq - b.seq);
  }

  // Latest classification per item, with any adjudication applied on top.
  // Supersession is resolved at read time; nothing is mutated.
  function classifications() {
    const events = all();
    const adjudications = new Map();
    for (const e of events) {
      if (e.type === "Adjudication") adjudications.set(e.payload.eventSeq, e);
    }
    return events
      .filter((e) => e.type === "ClassificationEvent")
      .map((e) => {
        const adj = adjudications.get(e.seq);
        return {
          ...e,
          adjudicated: !!adj,
          effectiveBin: adj ? adj.payload.correctedBin : e.payload.bin,
          adjudication: adj ? adj.payload : null
        };
      })
      .reverse();
  }

  function totals({ since = 0 } = {}) {
    const out = {};
    for (const c of classifications()) {
      if (c.ts < since) continue;
      const bin = c.effectiveBin;
      if (!bin) continue;
      out[bin] = out[bin] || { count: 0, kg: 0 };
      out[bin].count++;
      out[bin].kg += (c.payload.massG || 0) / 1000;
    }
    return out;
  }

  const reviewQueue = () =>
    classifications().filter((c) => c.payload.bin === "QUARANTINE" && !c.adjudicated);

  // ---- Integrity --------------------------------------------------------
  // Walks the chain and reports the first break. This is the function you
  // demo to a judge who asks "how do I know this wasn't edited".
  async function verify() {
    const events = all();
    let expectedPrev = GENESIS;
    for (const e of events) {
      if (e.prevHash !== expectedPrev) {
        return { ok: false, brokenAt: e.seq, reason: "Previous-hash link does not match" };
      }
      const recomputed = await sha256(canonical(e));
      if (recomputed !== e.hash) {
        return { ok: false, brokenAt: e.seq, reason: "Record contents do not match their hash" };
      }
      expectedPrev = e.hash;
    }
    return { ok: true, length: events.length };
  }

  // ---- Outbox -----------------------------------------------------------
  const pending = () => read(KEY_OUTBOX).length;

  // Stand-in for the real sync. Drains only when online; on failure the
  // entry stays queued with its try count so nothing is silently dropped.
  async function flush(post) {
    if (!navigator.onLine) return { sent: 0, remaining: pending(), offline: true };
    const outbox = read(KEY_OUTBOX);
    const events = all();
    const remaining = [];
    let sent = 0;
    for (const item of outbox) {
      try {
        await post(events[item.seq]);
        sent++;
      } catch {
        remaining.push({ ...item, tries: item.tries + 1 });
      }
    }
    write(KEY_OUTBOX, remaining);
    return { sent, remaining: remaining.length };
  }

  function reset() {
    memoryFallback = null;
    try { localStorage.removeItem(KEY_EVENTS); localStorage.removeItem(KEY_OUTBOX); } catch {}
  }

  return { append, all, byType, forBag, classifications, totals, reviewQueue, verify, pending, flush, reset };
})();

// ---------------------------------------------------------------------------
// Bag identity — CPCB bar code label format
//
//   ALLIN 110029 DL BH 00578  +  sequential
//   │     │      │  │  └─ 5-digit facility number
//   │     │      │  └──── 2-letter facility type
//   │     │      └─────── 2-letter state code
//   │     └────────────── 6-digit pincode
//   └──────────────────── 5-letter HCF name code
//
// The sequential number is centrally issued by the CBWTF's system in a real
// deployment. Here it is local and monotonic so the demo is self-contained.
const BagLabel = (() => {
  const KEY_SEQ = "medwaste.labelseq.v1";

  const FACILITY = {
    hcfCode: "ALLIN",
    pincode: "110029",
    state: "DL",
    type: "BH",       // BH = hospital
    number: "00578",
    name: "Ward demo facility",
    beds: 30
  };

  const prefix = () => `${FACILITY.hcfCode}${FACILITY.pincode}${FACILITY.state}${FACILITY.type}${FACILITY.number}`;

  function next() {
    let n = 1;
    try { n = (parseInt(localStorage.getItem(KEY_SEQ), 10) || 0) + 1; localStorage.setItem(KEY_SEQ, String(n)); }
    catch { n = Math.floor(Math.random() * 99999); }
    return `${prefix()}${String(n).padStart(6, "0")}`;
  }

  function parse(label) {
    if (typeof label !== "string" || label.length < 20) return null;
    return {
      hcfCode: label.slice(0, 5),
      pincode: label.slice(5, 11),
      state: label.slice(11, 13),
      type: label.slice(13, 15),
      number: label.slice(15, 20),
      sequential: label.slice(20)
    };
  }

  return { next, parse, prefix, FACILITY };
})();

// ---------------------------------------------------------------------------
// Session — who is acting. Roles are functional, not cosmetic: an override on
// a hazardous classification requires the waste manager role and always
// records who did it.
const Session = (() => {
  const KEY = "medwaste.session.v1";

  const ROLES = {
    housekeeping:  { name: "Housekeeping",  can: ["scan", "request_pickup"] },
    nurse:         { name: "Ward nurse",    can: ["scan", "request_pickup", "report_exception"] },
    waste_manager: { name: "Waste manager", can: ["scan", "request_pickup", "report_exception", "adjudicate", "override", "export"] },
    admin:         { name: "Administrator", can: ["scan", "request_pickup", "report_exception", "adjudicate", "override", "export", "configure"] }
  };

  let current = load();

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || { id: "u-demo", name: "A. Sharma", role: "waste_manager", ward: "ICU-2" };
    } catch {
      return { id: "u-demo", name: "A. Sharma", role: "waste_manager", ward: "ICU-2" };
    }
  }

  function set(patch) {
    current = { ...current, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch {}
    return current;
  }

  const get = () => current;
  const actor = () => `${current.id}:${current.role}`;
  const can = (action) => (ROLES[current.role]?.can || []).includes(action);

  return { get, set, actor, can, ROLES };
})();
