// MedWaste AI — policy layer test suite
//
//   node js/policy.test.js
//
// These are safety rules, so they are specified as tests before anything
// else exists. No model, no camera, no robot needed to run them.

const Policy = require("./policy.js");

let pass = 0, fail = 0;
const failures = [];

function check(name, obs, expect) {
  const got = Policy.decide(obs);
  const errs = [];
  for (const [k, v] of Object.entries(expect)) {
    if (got[k] !== v) errs.push(`${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`);
  }
  if (errs.length) { fail++; failures.push({ name, errs, explain: got.explain }); }
  else { pass++; }
}

// Convenience: a well-lit, working machine unless a test says otherwise.
const ok = (detections, extra = {}) => ({
  detections, modelStatus: "ready", cameraObstructed: false,
  metalSensor: null, massG: null, ...extra
});

const d = (classId, confidence) => ({ classId, confidence, bbox: [0, 0, 10, 10] });

// ---------------------------------------------------------------- R5 gate
check("R5 refuses when the model is unavailable",
  ok([d("glove", 0.99)], { modelStatus: "unavailable" }),
  { rule: "R5", action: "REFUSE", bin: null });

check("R5 refuses when the model is degraded",
  ok([d("glove", 0.99)], { modelStatus: "degraded" }),
  { rule: "R5", action: "REFUSE" });

check("R5 refuses on an obstructed camera even with a ready model",
  ok([d("glove", 0.99)], { cameraObstructed: true }),
  { rule: "R5", action: "REFUSE" });

check("R5 outranks a confident sharp — refusing beats guessing",
  ok([d("needle_loose", 0.99)], { modelStatus: "unavailable" }),
  { rule: "R5", action: "REFUSE" });

// ----------------------------------------------------------- R1 sharps veto
check("R1 routes an obvious needle to White",
  ok([d("needle_loose", 0.95)]),
  { rule: "R1", bin: "WHITE" });

check("R1 fires at 16% sharp evidence against an 80% glove",
  ok([d("glove", 0.80), d("needle_loose", 0.16)]),
  { rule: "R1", bin: "WHITE" });

check("R1 does not fire at 14% — threshold is 15%",
  ok([d("glove", 0.86), d("needle_loose", 0.14)]),
  { bin: "RED" });

check("R1 sums sharp evidence across classes",
  ok([d("glove", 0.82), d("lancet", 0.09), d("suture_needle", 0.09)]),
  { rule: "R1", bin: "WHITE" });

check("R1 treats unexplained metal as a sharp regardless of vision",
  ok([d("glove", 0.99)], { metalSensor: true }),
  { rule: "R1", bin: "WHITE" });

check("R1 does not fire on metal that vision expects",
  ok([d("metallic_implant", 0.95)], { metalSensor: true }),
  { bin: "BLUE" });

// ------------------------------------------------- R2 never downgrade to Black
check("R2 escalates general waste below 90% confidence",
  ok([d("paper_card", 0.85), d("clean_packaging", 0.15)]),
  { rule: "R2", action: "ESCALATE", bin: "YELLOW" });

check("R2 escalates when clinical evidence exceeds 5%",
  ok([d("food_waste", 0.92), d("cotton_gauze", 0.08)]),
  { rule: "R2", action: "ESCALATE", bin: "YELLOW" });

check("R2 allows Black when confident and clinically clean",
  ok([d("paper_card", 0.96), d("clean_packaging", 0.04)]),
  { bin: "BLACK", action: "ROUTE" });

check("R2 never applies to non-Black targets",
  ok([d("cotton_gauze", 0.55), d("soiled_dressing", 0.45)]),
  { bin: "YELLOW" });

// ------------------------------------------------------ R3 split decisions
check("R3 quarantines a coin flip across two bins",
  ok([d("glove", 0.52), d("cotton_gauze", 0.40)]),
  { rule: "R3", action: "QUARANTINE", bin: "QUARANTINE" });

check("R3 allows a clear margin across bins",
  ok([d("glove", 0.80), d("cotton_gauze", 0.20)]),
  { bin: "RED", action: "ROUTE" });

check("R3 ignores a close second call inside the same bin",
  ok([d("catheter", 0.45), d("urine_bag", 0.42)]),
  { bin: "RED", action: "ROUTE" });

check("R3 quarantines an empty frame",
  ok([]),
  { rule: "R3", bin: "QUARANTINE" });

// -------------------------------------------------------- R4 cytotoxic lock
check("R4 routes a cytotoxic vial to the labelled Yellow liner",
  ok([d("cytotoxic_vial", 0.88)]),
  { rule: "R4", bin: "YELLOW", cytotoxic: true });

check("R4 fires at 20% cytotoxic evidence",
  ok([d("drug_vial_residue", 0.78), d("cytotoxic_vial", 0.22)]),
  { rule: "R4", cytotoxic: true, bin: "YELLOW" });

check("R1 outranks R4 but keeps the cytotoxic flag",
  ok([d("cytotoxic_vial", 0.55), d("needle_loose", 0.45)]),
  { rule: "R1", bin: "WHITE", cytotoxic: true });

// --------------------------------------------------------- sensor fusion
check("Mass far outside range quarantines",
  ok([d("glass_slide", 0.95)], { massG: 800 }),
  { rule: "R3", bin: "QUARANTINE" });

check("Mass inside range routes normally",
  ok([d("glass_slide", 0.95)], { massG: 6 }),
  { bin: "BLUE", action: "ROUTE" });

check("Mass within the 2x tolerance band is accepted",
  ok([d("glove", 0.95)], { massG: 38 }),
  { bin: "RED", action: "ROUTE" });

check("Absent metal where vision expects it quarantines",
  ok([d("metallic_implant", 0.95)], { metalSensor: false }),
  { rule: "R3", bin: "QUARANTINE" });

// ------------------------------------------------------------------ report
const total = pass + fail;
console.log(`\n  Policy layer — ${pass}/${total} passing\n`);
for (const f of failures) {
  console.log(`  FAIL  ${f.name}`);
  f.errs.forEach((e) => console.log(`        ${e}`));
  console.log(`        explain: ${f.explain}\n`);
}
if (fail === 0) console.log("  R1 sharps veto · R2 no downgrade · R3 split quarantine · R4 cytotoxic lock · R5 refuse without model\n");
process.exit(fail === 0 ? 0 : 1);
