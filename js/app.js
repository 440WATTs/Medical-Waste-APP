// MedWaste AI — UI layer
//
// Owns all DOM. Knows nothing about how a decision was reached; it renders
// whatever Policy.decide returned and whatever the Ledger holds. Same
// separation the old app had between app.js and classifier.js, kept because
// it is what lets the mock fleet be swapped for a real robot without
// touching a screen.

(() => {
  const { BINS, ITEM_DB, REASON_CODES } = WasteDB;
  const THEME_KEY = "medwaste.theme";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // Ward names, staff notes and reason codes are user-supplied and end up
  // inside template strings. Escape everything on the way in — the old app
  // got away without this only because every value was a built-in constant.
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const pct = (n) => `${Math.round(n * 100)}%`;
  const kg = (n) => `${n.toFixed(2)} kg`;
  const binName = (id) => (BINS[id] ? BINS[id].name : "—");
  const itemName = (id) => (ITEM_DB[id] ? ITEM_DB[id].name : id);

  function timeAgo(ts) {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  const state = { screen: "home", robots: [], selectedRobot: "MW-01", ledgerFilter: "ALL", ledgerQuery: "" };

  // ---------- chrome ----------
  function snack(text) {
    const bar = $("#snackbar");
    bar.textContent = text;
    bar.classList.add("show");
    clearTimeout(snack._t);
    snack._t = setTimeout(() => bar.classList.remove("show"), 2600);
  }

  function openSheet(html) {
    $("#sheet-content").innerHTML = html;
    $("#sheet-backdrop").classList.add("show");
    $("#bottom-sheet").classList.add("show");
  }
  function closeSheet() {
    $("#sheet-backdrop").classList.remove("show");
    $("#bottom-sheet").classList.remove("show");
  }
  $("#sheet-backdrop").addEventListener("click", closeSheet);

  // ---------- theme ----------
  function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch {}
  }
  (function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch {}
    const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(saved || (dark ? "dark" : "light"));
  })();
  $("#theme-toggle").addEventListener("click", () => {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  // ---------- navigation ----------
  function go(name) {
    $$(".screen").forEach((s) => s.classList.remove("active"));
    $(`#screen-${name}`).classList.add("active");
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.screen === name));
    state.screen = name;
    window.scrollTo(0, 0);
    if (name === "home") renderHome();
    if (name === "fleet") renderFleet();
    if (name === "ledger") renderLedger();
    if (name === "review") renderReview();
  }
  $$(".nav-item").forEach((b) => b.addEventListener("click", () => go(b.dataset.screen)));
  $("#robot-back").addEventListener("click", () => go("fleet"));
  $("#record-back").addEventListener("click", () => go("ledger"));

  // ---------- shared fragments ----------
  const binChip = (id) =>
    `<span class="bin-chip bin-${esc(id)}">${esc(binName(id))}</span>`;

  const ruleBadge = (rule) =>
    `<span class="rule-badge rule-${esc(rule)}">${esc(rule)}</span>`;

  function decisionPanel(rec) {
    const d = rec.decision;
    const cls = d.action === "REFUSE" ? "refuse"
      : d.action === "QUARANTINE" ? "quarantine"
      : d.action === "ESCALATE" ? "escalate" : "";

    const breakdown = d.detections.map((x) => `
      <div class="breakdown">
        <div>${esc(itemName(x.classId))}</div>
        <div class="bd-bar"><div class="bd-fill" style="width:${pct(x.confidence)}"></div></div>
        <div class="bd-pct">${pct(x.confidence)}</div>
      </div>`).join("");

    const sensors = d.sensorAgreement.checks.map((c) => `
      <div class="sensor-row">
        <span class="sensor-flag ${c.agrees ? "ok" : "no"}">${c.agrees ? "✓" : "✗"}</span>
        <span>${esc(c.note)}</span>
      </div>`).join("") || `<div class="sensor-row"><span class="sensor-flag ok">&middot;</span><span>Vision only, no corroborating sensors on this unit.</span></div>`;

    const cyto = d.cytotoxic
      ? `<div class="status-banner warn" style="margin-top:12px;">Cytotoxic — separately labelled liner, never mixed.</div>` : "";

    return `
      <div class="decision ${cls}">
        <div class="decision-head">
          <span class="decision-bin" style="color:${d.bin ? BINS[d.bin].color : "var(--danger)"}">
            ${d.bin ? esc(BINS[d.bin].name) : "Refused"}
          </span>
          ${ruleBadge(d.rule)}
          <span style="margin-left:auto;font-size:12px;color:var(--text-muted);">${esc(rec.scenario || "")}</span>
        </div>
        <div class="decision-why">${esc(d.explain)}</div>
        ${cyto}
      </div>

      <div class="section-label">Detector output</div>
      <div class="card card-pad">${breakdown || "<em style='color:var(--text-muted);font-size:13px;'>Nothing detected.</em>"}</div>

      <div class="section-label">Sensor agreement</div>
      <div class="card card-pad">${sensors}</div>

      ${d.bin ? `
      <div class="section-label">Handling</div>
      <div class="card card-pad">
        <div style="font-size:13.5px;line-height:1.55;">
          <div style="margin-bottom:8px;"><strong>Container.</strong> ${esc(BINS[d.bin].container)}</div>
          <div style="margin-bottom:8px;"><strong>Treatment.</strong> ${esc(BINS[d.bin].treatment)}</div>
          <div><strong>PPE.</strong> ${esc(BINS[d.bin].ppe)}</div>
        </div>
      </div>` : ""}
    `;
  }

  // ---------- home ----------
  function renderHome() {
    const s = Session.get();
    $("#home-ward-label").textContent = `${s.ward} · ${Session.ROLES[s.role].name}`;

    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const totals = Ledger.totals({ since: startOfDay.getTime() });
    const order = ["YELLOW", "RED", "WHITE", "BLUE", "BLACK", "QUARANTINE"];
    const anyToday = order.some((b) => totals[b]);

    $("#home-stats").innerHTML = anyToday
      ? order.filter((b) => totals[b]).map((b) => `
          <div class="stat">
            <div class="k">${esc(binName(b))}</div>
            <div class="v" style="color:${BINS[b].color}">${totals[b].count}</div>
            <div class="s">${esc(kg(totals[b].kg))}</div>
          </div>`).join("")
      : `<div class="stat"><div class="k">Today</div><div class="v">0</div><div class="s">No items yet — run an intake</div></div>`;

    // Alerts are derived, not stored: fill above 80%, faults, and pending sync.
    const alerts = [];
    for (const r of state.robots) {
      for (const c of r.compartments) {
        if (c.fillPct >= 80) alerts.push({
          sev: c.fillPct >= 95 ? "high" : "",
          title: `${binName(c.category)} compartment at ${c.fillPct}%`,
          sub: `${r.id} ${r.name} — schedule a dock and swap`
        });
      }
      for (const f of r.faults) alerts.push({
        sev: f.severity === "high" ? "high" : "",
        title: `${r.id}: ${f.code.replace(/_/g, " ").toLowerCase()}`,
        sub: `Raised ${timeAgo(f.since)}`
      });
      if (r.battery < 25) alerts.push({ sev: "", title: `${r.id} battery ${Math.round(r.battery)}%`, sub: "Returning to dock" });
    }
    const queued = Ledger.reviewQueue().length;
    if (queued) alerts.push({ sev: "low", title: `${queued} item${queued > 1 ? "s" : ""} awaiting adjudication`, sub: "Held in the sealed compartment until reviewed" });

    $("#home-alerts").innerHTML = alerts.length
      ? alerts.map((a) => `
          <div class="alert sev-${esc(a.sev || "med")}">
            <div class="alert-body">
              <div class="alert-title">${esc(a.title)}</div>
              <div class="alert-sub">${esc(a.sub)}</div>
            </div>
          </div>`).join("")
      : `<div class="card card-pad" style="color:var(--text-muted);font-size:13.5px;">Nothing needs attention.</div>`;

    const recent = Ledger.classifications().slice(0, 5);
    $("#home-recent").innerHTML = recent.length
      ? recent.map((c) => rowFor(c)).join("")
      : `<div class="card-pad" style="color:var(--text-muted);font-size:13.5px;">No decisions recorded yet.</div>`;
    wireRecordRows($("#home-recent"));

    const pending = Ledger.pending();
    $("#sync-banner").innerHTML = !navigator.onLine
      ? `<div class="status-banner warn"><span class="dot-pulse"></span>Offline — ${pending} record${pending === 1 ? "" : "s"} queued, will sync when the network returns.</div>`
      : pending > 0
        ? `<div class="status-banner"><span class="dot-pulse"></span>${pending} record${pending === 1 ? "" : "s"} queued for the compliance server.</div>`
        : "";

    updateBadge();
  }

  const rowFor = (c) => `
    <div class="list-item" data-seq="${c.seq}">
      <div class="swatch" style="background:${BINS[c.effectiveBin]?.color || "var(--danger)"}"></div>
      <div class="list-info">
        <div class="list-title">${esc(itemName(c.payload.topClass))}</div>
        <div class="list-meta">${esc(c.effectiveBin ? binName(c.effectiveBin) : "Refused")} &middot; ${esc(c.payload.rule)} &middot; ${esc(timeAgo(c.ts))}${c.adjudicated ? " &middot; corrected" : ""}</div>
      </div>
      <svg class="chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>`;

  function wireRecordRows(root) {
    root.querySelectorAll(".list-item[data-seq]").forEach((el) =>
      el.addEventListener("click", () => openRecord(Number(el.dataset.seq))));
  }

  $("#request-pickup").addEventListener("click", requestPickup);
  $("#request-pickup").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); requestPickup(); } });

  async function requestPickup() {
    const s = Session.get();
    const nearest = state.robots.filter((r) => !r.faults.some((f) => f.severity === "high"))
      .sort((a, b) => (a.mission?.etaMin ?? 99) - (b.mission?.etaMin ?? 99))[0];
    if (!nearest) { snack("No unit available — all units have open faults"); return; }
    await Ledger.append("PickupRequest", { ward: s.ward, robotId: nearest.id }, {});
    snack(`${nearest.id} assigned to ${s.ward}`);
    renderHome();
  }

  // ---------- intake ----------
  function fillRobotSelect() {
    const sel = $("#intake-robot");
    sel.innerHTML = state.robots.map((r) =>
      `<option value="${esc(r.id)}"${r.id === state.selectedRobot ? " selected" : ""}>${esc(r.id)} — ${esc(r.name)}</option>`).join("");
    const r = Fleet.get(state.selectedRobot);
    if (r) $("#intake-model-status").value = r.modelStatus;
  }
  $("#intake-robot").addEventListener("change", (e) => { state.selectedRobot = e.target.value; fillRobotSelect(); });
  $("#intake-model-status").addEventListener("change", (e) => {
    Fleet.setModelStatus(state.selectedRobot, e.target.value);
    snack(`${state.selectedRobot} model status set to ${e.target.value}`);
  });

  $("#btn-run-intake").addEventListener("click", async () => {
    const rec = Fleet.simulateIntake(state.selectedRobot);
    const d = rec.decision;

    const { degraded } = await Ledger.append("ClassificationEvent", {
      robotId: rec.robotId,
      scenario: rec.scenario,
      topClass: d.detections[0]?.classId || "unknown",
      detections: d.detections,
      bin: d.bin,
      rule: d.rule,
      action: d.action,
      confidence: d.confidence,
      cytotoxic: d.cytotoxic,
      explain: d.explain,
      sensorAgreement: d.sensorAgreement,
      massG: rec.massG,
      modelVersion: "yolo11n-bmw-v0.1",
      imageHash: null
    }, { bagId: null });

    if (d.bin && d.action !== "REFUSE") {
      await Ledger.append("DepositEvent", { robotId: rec.robotId, compartment: d.bin, massG: rec.massG });
    }

    $("#intake-result").innerHTML = decisionPanel(rec);
    if (degraded) snack("Device storage full — recording in memory for this session");
    else if (d.action === "REFUSE") snack("Intake locked. Unit returning to dock.");
    else if (d.action === "QUARANTINE") snack("Held for review");
    updateBadge();
  });

  // ---------- fleet ----------
  function renderFleet() {
    $("#fleet-list").innerHTML = state.robots.map((r) => {
      const worst = Math.max(...r.compartments.map((c) => c.fillPct));
      const fault = r.faults[0];
      return `
        <div class="card" data-robot="${esc(r.id)}" style="cursor:pointer;">
          <div class="card-row" style="border-bottom:1px solid var(--line);">
            <div class="swatch" style="background:${fault ? "var(--danger)" : r.charging ? "var(--good)" : "var(--accent)"}"></div>
            <div class="list-info">
              <div class="list-title">${esc(r.id)} &middot; ${esc(r.name)}</div>
              <div class="list-meta">${esc(r.mission ? `${r.mission.type.replace(/_/g, " ")} — ${r.mission.ward || "dock"}, ${r.mission.etaMin} min` : "Idle at dock")}</div>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="card-pad">
            <div class="stat-grid cols-2" style="margin:0;border:none;">
              <div class="stat" style="padding:8px 10px;"><div class="k">Battery</div><div class="v" style="font-size:16px;color:${r.battery < 25 ? "var(--danger)" : "inherit"}">${Math.round(r.battery)}%</div></div>
              <div class="stat" style="padding:8px 10px;"><div class="k">Floor</div><div class="v" style="font-size:16px;">${esc(String(r.pose.floor))}</div></div>
              <div class="stat" style="padding:8px 10px;"><div class="k">Fullest</div><div class="v" style="font-size:16px;color:${worst >= 80 ? "var(--warn)" : "inherit"}">${worst}%</div></div>
              <div class="stat" style="padding:8px 10px;"><div class="k">Model</div><div class="v" style="font-size:13px;color:${r.modelStatus === "ready" ? "var(--good)" : "var(--danger)"}">${esc(r.modelStatus)}</div></div>
            </div>
          </div>
        </div>`;
    }).join("");

    $$("[data-robot]").forEach((el) => el.addEventListener("click", () => openRobot(el.dataset.robot)));
  }

  function openRobot(id) {
    state.selectedRobot = id;
    go("robot");
    renderRobot();
  }

  function renderRobot() {
    const r = Fleet.get(state.selectedRobot);
    if (!r) return;
    $("#robot-title").textContent = `${r.id} · ${r.name}`;

    const meters = r.compartments.map((c) => `
      <div class="meter-row ${c.fillPct >= 80 ? "over" : ""}">
        <div class="bin-chip bin-${esc(c.category)}">${esc(binName(c.category))}</div>
        <div class="meter-track"><div class="meter-fill" style="width:${c.fillPct}%;background:${BINS[c.category].color}"></div></div>
        <div class="meter-pct">${c.fillPct}%</div>
      </div>`).join("");

    const faults = r.faults.length
      ? r.faults.map((f) => `
          <div class="alert sev-${esc(f.severity === "high" ? "high" : "med")}">
            <div class="alert-body">
              <div class="alert-title">${esc(f.code.replace(/_/g, " "))}</div>
              <div class="alert-sub">Raised ${esc(timeAgo(f.since))}</div>
            </div>
          </div>`).join("")
      : `<div class="card card-pad" style="color:var(--text-muted);font-size:13.5px;">No open faults.</div>`;

    $("#robot-body").innerHTML = `
      <div class="stat-grid cols-2">
        <div class="stat"><div class="k">Battery</div><div class="v">${Math.round(r.battery)}%</div><div class="s">${r.charging ? "charging" : "on battery"}</div></div>
        <div class="stat"><div class="k">Location</div><div class="v" style="font-size:15px;">${esc(r.pose.zone)}</div><div class="s">floor ${esc(String(r.pose.floor))}</div></div>
        <div class="stat"><div class="k">UV cycles</div><div class="v">${r.uvCycles}</div><div class="s">interlocked</div></div>
        <div class="stat"><div class="k">Load</div><div class="v">${r.compartments.reduce((a, c) => a + c.weightKg, 0).toFixed(1)}</div><div class="s">kg on board</div></div>
      </div>

      <div class="section-label">Compartments</div>
      <div class="card card-pad">${meters}</div>

      <div class="section-label">Faults</div>
      ${faults}

      <div class="section-label">Control</div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="btn-dock">Return to dock</button>
        <button class="btn btn-danger" id="btn-estop">Emergency stop</button>
      </div>
      <p style="font-size:12px;color:var(--text-faint);margin-top:10px;line-height:1.5;">
        Emergency stop cuts drive power and locks all compartments. Contents stay sealed; nothing
        is released until a waste manager clears the unit on site.
      </p>`;

    $("#btn-dock").addEventListener("click", () => {
      r.mission = { id: "m-dock", type: "return_to_dock", ward: null, etaMin: 3 };
      snack(`${r.id} returning to dock`);
      renderRobot();
    });
    $("#btn-estop").addEventListener("click", () => {
      openSheet(`
        <h3>Emergency stop ${esc(r.id)}?</h3>
        <p>Drive power is cut immediately and every compartment locks. The unit cannot resume its
        round until a waste manager clears it on site. Use this only if the machine is a hazard
        right now.</p>
        <div class="btn-row">
          <button class="btn btn-secondary" id="estop-cancel">Cancel</button>
          <button class="btn btn-danger" id="estop-confirm">Stop the unit</button>
        </div>`);
      $("#estop-cancel").addEventListener("click", closeSheet);
      $("#estop-confirm").addEventListener("click", async () => {
        r.mission = null;
        if (!r.faults.some((f) => f.code === "ESTOP")) r.faults.push({ code: "ESTOP", severity: "high", since: Date.now() });
        await Ledger.append("EmergencyStop", { robotId: r.id });
        closeSheet();
        snack(`${r.id} stopped`);
        renderRobot();
      });
    });
  }

  // ---------- ledger ----------
  const FILTERS = ["ALL", "WHITE", "YELLOW", "RED", "BLUE", "BLACK", "QUARANTINE"];

  function renderLedger() {
    $("#ledger-filters").innerHTML = FILTERS.map((f) =>
      `<button class="filter-chip ${state.ledgerFilter === f ? "active" : ""}" data-filter="${esc(f)}">${esc(f === "ALL" ? "All" : binName(f))}</button>`).join("");
    $$("[data-filter]").forEach((b) => b.addEventListener("click", () => {
      state.ledgerFilter = b.dataset.filter;
      renderLedger();
    }));

    const q = state.ledgerQuery.toLowerCase();
    const rows = Ledger.classifications().filter((c) => {
      if (state.ledgerFilter !== "ALL" && c.effectiveBin !== state.ledgerFilter) return false;
      if (!q) return true;
      return [itemName(c.payload.topClass), binName(c.effectiveBin), c.payload.rule]
        .join(" ").toLowerCase().includes(q);
    });

    $("#ledger-list").innerHTML = rows.length
      ? `<div class="card">${rows.map(rowFor).join("")}</div>`
      : `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M8 11h8M8 15h5"/></svg><div>No records match</div></div>`;
    wireRecordRows($("#ledger-list"));
  }
  $("#ledger-search").addEventListener("input", (e) => { state.ledgerQuery = e.target.value; renderLedger(); });

  $("#btn-verify-chain").addEventListener("click", async () => {
    const res = await Ledger.verify();
    openSheet(res.ok
      ? `<h3>Chain intact</h3>
         <p>All ${res.length} record${res.length === 1 ? "" : "s"} verified. Each one carries the
         SHA-256 of the record before it, so any retroactive edit would break the chain from that
         point on and be reported here with its sequence number.</p>
         <button class="btn btn-secondary" id="verify-close">Close</button>`
      : `<h3>Chain broken at record ${esc(String(res.brokenAt))}</h3>
         <p>${esc(res.reason)}. Every record from this point forward is untrustworthy and must be
         reconciled against the server copy.</p>
         <button class="btn btn-secondary" id="verify-close">Close</button>`);
    $("#verify-close").addEventListener("click", closeSheet);
  });

  // ---------- record detail ----------
  function openRecord(seq) {
    const c = Ledger.classifications().find((x) => x.seq === seq);
    if (!c) return;
    const p = c.payload;

    const trail = Ledger.all()
      .filter((e) => e.seq === seq || (e.type === "Adjudication" && e.payload.eventSeq === seq)
        || (e.type === "DepositEvent" && Math.abs(e.seq - seq) === 1))
      .map((e) => `
        <div class="sensor-row">
          <span class="sensor-flag ok">&middot;</span>
          <span><strong>${esc(e.type)}</strong> — ${esc(new Date(e.ts).toLocaleString())}<br>
          <span class="mono" style="font-size:11px;color:var(--text-faint);">${esc(e.actor)} &middot; ${esc(e.hash.slice(0, 16))}…</span></span>
        </div>`).join("");

    const canAdjudicate = Session.can("adjudicate");
    const adjSection = c.adjudicated
      ? `<div class="card card-pad">
           <div style="font-size:13.5px;">Corrected to ${binChip(c.adjudication.correctedBin)} by
           <span class="mono">${esc(c.adjudication.reviewerId)}</span> — ${esc(REASON_CODES[c.adjudication.reasonCode] || c.adjudication.reasonCode)}.</div>
         </div>`
      : canAdjudicate
        ? `<button class="btn btn-secondary" id="btn-adjudicate">Override this decision</button>
           <p style="font-size:12px;color:var(--text-faint);margin-top:9px;line-height:1.5;">
           The original record is never edited. An override is a new event that supersedes it, and
           both stay in the ledger.</p>`
        : `<div class="card card-pad" style="font-size:13px;color:var(--text-muted);">
             Overriding a hazardous classification needs the waste manager role.</div>`;

    $("#record-body").innerHTML = `
      ${decisionPanel({ decision: {
        detections: p.detections, bin: p.bin, rule: p.rule, action: p.action,
        confidence: p.confidence, cytotoxic: p.cytotoxic, explain: p.explain,
        sensorAgreement: p.sensorAgreement
      }, scenario: p.scenario })}

      <div class="section-label">Provenance</div>
      <div class="card card-pad">
        <div class="settings-row"><div class="settings-label">Unit</div><div class="settings-value mono">${esc(p.robotId)}</div></div>
        <div class="settings-row"><div class="settings-label">Mass</div><div class="settings-value tnum">${esc(String(p.massG))} g</div></div>
        <div class="settings-row"><div class="settings-label">Model version</div><div class="settings-value mono">${esc(p.modelVersion)}</div></div>
        <div class="settings-row"><div class="settings-label">Recorded</div><div class="settings-value">${esc(new Date(c.ts).toLocaleString())}</div></div>
        <div class="settings-row"><div class="settings-label">Record hash</div><div class="settings-value mono" style="font-size:11px;">${esc(c.hash.slice(0, 20))}…</div></div>
      </div>

      <div class="section-label">Chain of custody</div>
      <div class="card card-pad">${trail}</div>

      <div class="section-label">Adjudication</div>
      ${adjSection}`;

    go("record");

    const btn = $("#btn-adjudicate");
    if (btn) btn.addEventListener("click", () => adjudicateSheet(c));
  }

  function adjudicateSheet(c) {
    const bins = Object.keys(BINS).filter((b) => b !== "QUARANTINE");
    openSheet(`
      <h3>Correct this decision</h3>
      <p>Machine routed it to <strong>${esc(binName(c.payload.bin))}</strong> under ${esc(c.payload.rule)}.
      Your correction becomes a labelled training example.</p>
      <div class="section-label">Correct destination</div>
      <div class="card">${bins.map((b) => `
        <div class="list-item" data-bin="${esc(b)}">
          <div class="swatch" style="background:${BINS[b].color}"></div>
          <div class="list-info">
            <div class="list-title">${esc(BINS[b].name)}</div>
            <div class="list-meta">${esc(BINS[b].label)}</div>
          </div>
        </div>`).join("")}</div>`);

    $$("#sheet-content [data-bin]").forEach((el) => el.addEventListener("click", () => {
      const bin = el.dataset.bin;
      openSheet(`
        <h3>Why was it wrong?</h3>
        <p>Routing to ${esc(binName(bin))}. Pick the closest reason — the fixed vocabulary is what
        makes this data usable later.</p>
        <div class="card">${Object.entries(REASON_CODES).map(([code, label]) => `
          <div class="list-item" data-reason="${esc(code)}">
            <div class="list-info"><div class="list-title">${esc(label)}</div>
            <div class="list-meta mono">${esc(code)}</div></div>
          </div>`).join("")}</div>`);

      $$("#sheet-content [data-reason]").forEach((r) => r.addEventListener("click", async () => {
        await Ledger.append("Adjudication", {
          eventSeq: c.seq,
          originalBin: c.payload.bin,
          correctedBin: bin,
          reasonCode: r.dataset.reason,
          reviewerId: Session.get().id
        });
        closeSheet();
        snack(`Corrected to ${binName(bin)}`);
        updateBadge();
        openRecord(c.seq);
      }));
    }));
  }

  // ---------- review queue ----------
  function renderReview() {
    const queue = Ledger.reviewQueue();
    $("#review-list").innerHTML = queue.length
      ? `<div class="card">${queue.map(rowFor).join("")}</div>`
      : `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg><div>Nothing awaiting review</div></div>`;
    wireRecordRows($("#review-list"));
  }

  function updateBadge() {
    const n = Ledger.reviewQueue().length;
    const badge = $("#review-badge");
    badge.textContent = String(n);
    badge.classList.toggle("hidden", n === 0);
  }

  // ---------- settings ----------
  $("#open-settings").addEventListener("click", () => {
    const s = Session.get();
    openSheet(`
      <h3>Settings</h3>
      <div class="card card-pad">
        <div class="settings-row">
          <div class="settings-label">Role</div>
          <select class="settings-value" id="set-role">
            ${Object.entries(Session.ROLES).map(([k, v]) =>
              `<option value="${esc(k)}"${k === s.role ? " selected" : ""}>${esc(v.name)}</option>`).join("")}
          </select>
        </div>
        <div class="settings-row">
          <div class="settings-label">Ward</div>
          <select class="settings-value" id="set-ward">
            ${["ICU-2", "Ward-2B", "Theatre-1", "Emergency"].map((w) =>
              `<option value="${esc(w)}"${w === s.ward ? " selected" : ""}>${esc(w)}</option>`).join("")}
          </select>
        </div>
        <div class="settings-row"><div class="settings-label">Facility</div><div class="settings-value mono" style="font-size:11px;">${esc(BagLabel.prefix())}</div></div>
        <div class="settings-row"><div class="settings-label">Model</div><div class="settings-value mono" style="font-size:11px;">yolo11n-bmw-v0.1</div></div>
        <div class="settings-row"><div class="settings-label">Queued for sync</div><div class="settings-value tnum">${Ledger.pending()}</div></div>
      </div>
      <div class="section-label">Data</div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="set-export">Export ledger</button>
        <button class="btn btn-secondary" id="set-reset" style="color:var(--danger);border-color:var(--danger);">Reset demo</button>
      </div>`);

    $("#set-role").addEventListener("change", (e) => { Session.set({ role: e.target.value }); renderHome(); snack(`Role: ${Session.ROLES[e.target.value].name}`); });
    $("#set-ward").addEventListener("change", (e) => { Session.set({ ward: e.target.value }); renderHome(); });

    $("#set-export").addEventListener("click", () => {
      if (!Session.can("export")) { snack("Export needs the waste manager role"); return; }
      const blob = new Blob([JSON.stringify(Ledger.all(), null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `medwaste-ledger-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      closeSheet();
      snack("Ledger exported");
    });

    $("#set-reset").addEventListener("click", () => {
      Ledger.reset();
      closeSheet();
      snack("Demo data cleared");
      renderHome();
      updateBadge();
    });
  });

  // ---------- boot ----------
  Fleet.subscribe((robots) => {
    state.robots = robots;
    if (state.screen === "fleet") renderFleet();
    if (state.screen === "robot") renderRobot();
    if (state.screen === "home") {
      const nearest = robots.map((r) => r.mission?.etaMin).filter((x) => typeof x === "number").sort((a, b) => a - b)[0];
      $("#pickup-eta").textContent = nearest != null ? `Nearest unit ${nearest} min away` : "All units idle";
    }
  });

  fillRobotSelect();
  renderHome();
  updateBadge();

  window.addEventListener("online", renderHome);
  window.addEventListener("offline", renderHome);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js").catch(() => {}));
  }
})();
