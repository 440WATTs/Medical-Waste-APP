// MedWaste AI — segregation policy layer
//
// Sits between the detector and the diverter. Deterministic, pure, and
// unit-testable without a model. Changing safety behaviour here never
// requires a training run, and every decision carries the rule that
// produced it so a regulator can be told *why*, not just *what*.
//
//   decide(observation) -> Decision
//
// Evaluation order is NOT rule number order. R5 gates everything (no model,
// no decision), then R1 takes precedence over all routing because a
// mis-binned sharp injures a person. Order is fixed and tested.

const Policy = (() => {
  // Same file runs under Node (for the test suite) and in the browser, where
  // waste-db.js has already put these in the global lexical scope.
  const DB = (typeof module !== "undefined" && module.exports)
    ? require("./waste-db.js")
    : window.WasteDB;
  const { BINS, HAZARD_LADDER, ITEM_DB, SHARP_CLASSES, CLINICAL_CLASSES, CYTOTOXIC_CLASSES } = DB;

  // --- Tunables. Every one of these is a safety decision, not a magic number.
  const T = {
    SHARP_VETO: 0.15,        // R1. Deliberately low: recall over precision.
    BLACK_MIN: 0.90,         // R2. General waste needs near-certainty.
    BLACK_CLINICAL_MAX: 0.05,// R2. And near-zero clinical evidence.
    SPLIT_MARGIN: 0.25,      // R3. Below this the top-2 is a coin flip.
    CYTOTOXIC_MIN: 0.20,     // R4. Also low — mixing cytotoxic is a distinct offence.
    MASS_TOLERANCE: 2.0      // Fusion. Load cell may be off by this factor before we call it disagreement.
  };

  // Metal is expected for these classes, so its presence is not a surprise.
  const METAL_EXPECTED = new Set([...SHARP_CLASSES, "metallic_implant"]);

  const sumP = (dets, ids) =>
    dets.reduce((a, d) => (ids.includes(d.classId) ? a + d.confidence : a), 0);

  const binOf = (classId) => (ITEM_DB[classId] ? ITEM_DB[classId].bin : "QUARANTINE");

  const higherHazard = (a, b) =>
    HAZARD_LADDER.indexOf(a) >= HAZARD_LADDER.indexOf(b) ? a : b;

  // --- Sensor fusion -----------------------------------------------------
  // Three independent signals: vision, inductive metal proximity, load cell.
  // Returns what each sensor says and whether they contradict each other.
  function fuse(obs) {
    const top = obs.detections[0];
    const checks = [];

    if (obs.metalSensor === true) {
      const expected = top && METAL_EXPECTED.has(top.classId);
      checks.push({
        sensor: "metal",
        agrees: expected,
        note: expected ? "Metal present, consistent with vision" : "Metal detected but vision sees no metal item"
      });
    } else if (obs.metalSensor === false) {
      const expected = top && METAL_EXPECTED.has(top.classId);
      checks.push({
        sensor: "metal",
        agrees: !expected,
        note: expected ? "Vision says metal item but sensor found none" : "No metal, consistent with vision"
      });
    }

    if (typeof obs.massG === "number" && top && ITEM_DB[top.classId]) {
      const [lo, hi] = ITEM_DB[top.classId].massRange;
      const ok = obs.massG >= lo / T.MASS_TOLERANCE && obs.massG <= hi * T.MASS_TOLERANCE;
      checks.push({
        sensor: "mass",
        agrees: ok,
        note: ok
          ? `${obs.massG} g within expected range for ${ITEM_DB[top.classId].name}`
          : `${obs.massG} g outside expected ${lo}–${hi} g for ${ITEM_DB[top.classId].name}`
      });
    }

    return { checks, allAgree: checks.every((c) => c.agrees) };
  }

  // --- Main entry point --------------------------------------------------
  function decide(obs) {
    const dets = (obs.detections || []).slice().sort((a, b) => b.confidence - a.confidence);
    const top = dets[0];
    const fusion = fuse({ ...obs, detections: dets });
    const base = { detections: dets, sensorAgreement: fusion, cytotoxic: false, refused: false };

    // R5 — no inference without a model. Evaluated first: it gates everything.
    // This is the deliberate inversion of the old heuristic fallback. The
    // machine refuses rather than estimates.
    if (obs.modelStatus !== "ready" || obs.cameraObstructed === true) {
      const why = obs.cameraObstructed
        ? "Camera obstructed"
        : `Model ${obs.modelStatus || "unavailable"}`;
      return {
        ...base,
        bin: null,
        rule: "R5",
        action: "REFUSE",
        confidence: 0,
        explain: `${why}. Intake locked, contents sealed, returning to dock.`
      };
    }

    if (!top) {
      return {
        ...base,
        bin: "QUARANTINE",
        rule: "R3",
        action: "QUARANTINE",
        confidence: 0,
        explain: "No item detected in frame."
      };
    }

    // Cytotoxic is a flag, not an exclusive route: a cytotoxic sharp is still
    // a sharp first. Computed here, applied to whatever bin is chosen below.
    const pCyto = sumP(dets, CYTOTOXIC_CLASSES);
    const cytotoxic = pCyto >= T.CYTOTOXIC_MIN;

    // R1 — sharps veto. Fires on vision evidence OR unexplained metal.
    const pSharp = sumP(dets, SHARP_CLASSES);
    const metalSurprise = obs.metalSensor === true && !METAL_EXPECTED.has(top.classId);
    if (pSharp > T.SHARP_VETO || metalSurprise) {
      return {
        ...base,
        bin: "WHITE",
        rule: "R1",
        action: "ROUTE",
        cytotoxic,
        confidence: Math.max(pSharp, metalSurprise ? 1 : 0),
        explain: metalSurprise
          ? `Metal sensor fired but vision called "${ITEM_DB[top.classId].name}". Unexplained metal is treated as a sharp.`
          : `Sharp evidence ${(pSharp * 100).toFixed(0)}% exceeds the ${T.SHARP_VETO * 100}% veto threshold.`
      };
    }

    // R4 — cytotoxic lock. Separately labelled liner inside Yellow, never mixed.
    if (cytotoxic) {
      return {
        ...base,
        bin: "YELLOW",
        rule: "R4",
        action: "ROUTE",
        cytotoxic: true,
        confidence: pCyto,
        explain: `Cytotoxic evidence ${(pCyto * 100).toFixed(0)}%. Routed to the separately labelled cytotoxic liner.`
      };
    }

    // Sensor disagreement quarantines before any bin is chosen.
    if (!fusion.allAgree) {
      const bad = fusion.checks.find((c) => !c.agrees);
      return {
        ...base,
        bin: "QUARANTINE",
        rule: "R3",
        action: "QUARANTINE",
        confidence: top.confidence,
        explain: `Sensors disagree. ${bad.note}.`
      };
    }

    // R3 — split decisions quarantine. A coin flip must not actuate a diverter.
    const second = dets[1];
    if (second && binOf(second.classId) !== binOf(top.classId)
        && top.confidence - second.confidence < T.SPLIT_MARGIN) {
      return {
        ...base,
        bin: "QUARANTINE",
        rule: "R3",
        action: "QUARANTINE",
        confidence: top.confidence,
        explain: `Top two calls span ${BINS[binOf(top.classId)].name} and ${BINS[binOf(second.classId)].name} with only ${((top.confidence - second.confidence) * 100).toFixed(0)}% between them.`
      };
    }

    const target = binOf(top.classId);

    // R2 — never downgrade to general waste. Doubt escalates, never descends.
    if (target === "BLACK") {
      const pClinical = sumP(dets, CLINICAL_CLASSES);
      if (top.confidence < T.BLACK_MIN || pClinical > T.BLACK_CLINICAL_MAX) {
        const escalated = higherHazard("YELLOW", target);
        return {
          ...base,
          bin: escalated,
          rule: "R2",
          action: "ESCALATE",
          confidence: top.confidence,
          explain: top.confidence < T.BLACK_MIN
            ? `General waste needs ${T.BLACK_MIN * 100}% confidence; this call is ${(top.confidence * 100).toFixed(0)}%. Escalated.`
            : `Clinical evidence ${(pClinical * 100).toFixed(0)}% exceeds the ${T.BLACK_CLINICAL_MAX * 100}% ceiling for general waste. Escalated.`
        };
      }
    }

    // Nothing fired. Route on the detector's own call.
    return {
      ...base,
      bin: target,
      rule: "PASS",
      action: "ROUTE",
      confidence: top.confidence,
      explain: `${ITEM_DB[top.classId].name} at ${(top.confidence * 100).toFixed(0)}% confidence, all sensors in agreement.`
    };
  }

  return { decide, THRESHOLDS: T, fuse };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Policy;
