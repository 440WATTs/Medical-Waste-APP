// MedWaste AI — mock robot fleet
//
// Stands in for the MQTT telemetry stream and the /v1/classifications
// endpoint described in the integration spec, so the whole app is
// demonstrable with zero hardware. The shapes here ARE the contract: when
// the real edge device arrives, delete this file and point the same
// subscribers at the socket.
//
//   Fleet.subscribe(fn)  -> fn(robots) at 1 Hz, matching the real cadence
//   Fleet.simulateIntake(robotId) -> one detection, run through Policy

const Fleet = (() => {
  const TICK_MS = 1000;

  const COMPARTMENT_SPLIT = {
    YELLOW: 0.35, RED: 0.30, BLACK: 0.15, BLUE: 0.08, WHITE: 0.07, QUARANTINE: 0.05
  };
  const TOTAL_CAPACITY_L = 120;

  const mkCompartments = (fill) =>
    Object.entries(COMPARTMENT_SPLIT).map(([category, share]) => ({
      category,
      capacityL: +(TOTAL_CAPACITY_L * share).toFixed(1),
      fillPct: Math.round((fill[category] ?? 0) * 100),
      weightKg: +((fill[category] ?? 0) * TOTAL_CAPACITY_L * share * 0.09).toFixed(2),
      lidState: "closed"
    }));

  const robots = [
    {
      id: "MW-01", name: "Corridor A",
      battery: 78, charging: false,
      pose: { floor: 3, zone: "ICU-2 utility", x: 14.2, y: 8.1 },
      mission: { id: "m-4417", type: "collection", ward: "ICU-2", etaMin: 4 },
      faults: [],
      modelStatus: "ready",
      uvCycles: 12,
      compartments: mkCompartments({ YELLOW: 0.62, RED: 0.44, BLACK: 0.20, BLUE: 0.31, WHITE: 0.55, QUARANTINE: 0.10 })
    },
    {
      id: "MW-02", name: "Corridor B",
      battery: 31, charging: false,
      pose: { floor: 2, zone: "Ward 2B", x: 6.7, y: 22.4 },
      mission: { id: "m-4418", type: "collection", ward: "Ward-2B", etaMin: 11 },
      faults: [],
      modelStatus: "ready",
      uvCycles: 9,
      compartments: mkCompartments({ YELLOW: 0.88, RED: 0.51, BLACK: 0.33, BLUE: 0.12, WHITE: 0.71, QUARANTINE: 0.40 })
    },
    {
      id: "MW-03", name: "Theatre block",
      battery: 96, charging: true,
      pose: { floor: 1, zone: "Dock 1", x: 0.5, y: 1.0 },
      mission: null,
      faults: [{ code: "VISION_DEGRADED", severity: "high", since: Date.now() - 1000 * 60 * 7 }],
      modelStatus: "degraded",
      uvCycles: 21,
      compartments: mkCompartments({ YELLOW: 0.05, RED: 0.02, BLACK: 0.00, BLUE: 0.00, WHITE: 0.03, QUARANTINE: 0.00 })
    }
  ];

  // Scripted intake scenarios. Each one exercises a different policy rule so
  // a demo can walk the rules in order instead of hoping randomness obliges.
  const SCENARIOS = [
    { label: "Used glove",              detections: [["glove", 0.93], ["catheter", 0.05]], metalSensor: false, massG: 9 },
    { label: "Needle in the red stream", detections: [["glove", 0.71], ["needle_loose", 0.24]], metalSensor: true, massG: 4 },
    { label: "Soiled dressing",         detections: [["soiled_dressing", 0.89], ["cotton_gauze", 0.09]], metalSensor: false, massG: 46 },
    { label: "Paper with fluid traces", detections: [["paper_card", 0.86], ["cotton_gauze", 0.11]], metalSensor: false, massG: 22 },
    { label: "Chemo vial",              detections: [["cytotoxic_vial", 0.81], ["drug_vial_residue", 0.14]], metalSensor: false, massG: 18 },
    { label: "Ambiguous wet mass",      detections: [["cotton_gauze", 0.48], ["glove", 0.39]], metalSensor: false, massG: 15 },
    { label: "Empty ampoule",           detections: [["glass_ampoule", 0.94], ["glass_vial_empty", 0.04]], metalSensor: false, massG: 7 },
    { label: "Clean carton",            detections: [["paper_card", 0.97], ["clean_packaging", 0.02]], metalSensor: false, massG: 60 },
    { label: "Scalpel blade",           detections: [["scalpel_blade", 0.91], ["glass_slide", 0.05]], metalSensor: true, massG: 6 },
    { label: "Unreadable, camera fogged", detections: [["cotton_gauze", 0.44]], metalSensor: false, massG: 30, cameraObstructed: true }
  ];

  let scenarioIndex = 0;
  const subscribers = new Set();
  let timer = null;

  function tick() {
    for (const r of robots) {
      if (r.charging) r.battery = Math.min(100, r.battery + 0.4);
      else if (r.mission) r.battery = Math.max(0, r.battery - 0.05);

      if (r.mission && r.mission.etaMin > 0 && Math.random() < 0.25) {
        r.mission.etaMin = Math.max(0, +(r.mission.etaMin - 0.1).toFixed(1));
      }
      // Auto-dock at low charge — the behaviour the fleet screen must surface.
      if (r.battery < 20 && !r.charging && !r.faults.some((f) => f.code === "LOW_BATTERY")) {
        r.faults.push({ code: "LOW_BATTERY", severity: "medium", since: Date.now() });
        r.mission = { id: "m-dock", type: "return_to_dock", ward: null, etaMin: 3 };
      }
    }
    emit();
  }

  const emit = () => subscribers.forEach((fn) => fn(snapshot()));

  const snapshot = () => JSON.parse(JSON.stringify(robots));

  function subscribe(fn) {
    subscribers.add(fn);
    fn(snapshot());
    if (!timer) timer = setInterval(tick, TICK_MS);
    return () => {
      subscribers.delete(fn);
      if (!subscribers.size) { clearInterval(timer); timer = null; }
    };
  }

  const get = (id) => robots.find((r) => r.id === id);

  // One item through the hood: detector output, sensor fusion, policy, deposit.
  // Returns the same shape the real POST /v1/classifications body carries.
  function simulateIntake(robotId) {
    const robot = get(robotId) || robots[0];
    const s = SCENARIOS[scenarioIndex % SCENARIOS.length];
    scenarioIndex++;

    const observation = {
      detections: s.detections.map(([classId, confidence]) => ({
        classId, confidence, bbox: [40, 40, 180, 180]
      })),
      metalSensor: s.metalSensor,
      massG: s.massG,
      modelStatus: robot.modelStatus,
      cameraObstructed: !!s.cameraObstructed
    };

    const decision = Policy.decide(observation);

    if (decision.bin) {
      const comp = robot.compartments.find((c) => c.category === decision.bin);
      if (comp) {
        comp.fillPct = Math.min(100, comp.fillPct + 2);
        comp.weightKg = +(comp.weightKg + s.massG / 1000).toFixed(2);
      }
    }
    if (decision.action === "REFUSE") {
      robot.mission = { id: "m-dock", type: "return_to_dock", ward: null, etaMin: 2 };
      if (!robot.faults.some((f) => f.code === "INTAKE_LOCKED")) {
        robot.faults.push({ code: "INTAKE_LOCKED", severity: "high", since: Date.now() });
      }
    }
    emit();

    return { robotId: robot.id, scenario: s.label, observation, decision, massG: s.massG };
  }

  // Lets the demo force the R5 path without waiting for the scripted scenario.
  function setModelStatus(robotId, status) {
    const r = get(robotId);
    if (r) { r.modelStatus = status; emit(); }
  }

  return { subscribe, snapshot, get, simulateIntake, setModelStatus, SCENARIOS, TOTAL_CAPACITY_L };
})();
