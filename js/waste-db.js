// MedWaste AI — waste knowledge base
//
// Structure deliberately mirrors the old PlasticDetect data.js contract
// (id -> info object) so the render layer stays unchanged. Contents are
// entirely replaced: 6 plastic resins become 24 biomedical item classes
// mapped onto the 5 statutory BMWM Rules 2016 destinations plus one
// non-statutory quarantine stream.
//
// Nothing here does any work. Pure data, so policy.js can be tested
// without a model, a camera or a robot.

// ---- Destinations -----------------------------------------------------
// `handlerRisk` orders acute risk to the person handling the bag, which is
// what R1/R2 in policy.js escalate along. It is NOT the same as regulatory
// severity — see the note on R2.
const BINS = {
  WHITE: {
    id: "WHITE",
    name: "White",
    label: "Sharps",
    color: "#7D8C8C",
    swatch: "#F2F5F5",
    container: "Translucent, rigid, puncture-proof container",
    treatment: "Autoclave or dry-heat sterilise, then needle destroyer / shredder, then encapsulation or secured landfill",
    handlerRisk: 5,
    ppe: "Cut-resistant gloves. Never recap, never hand-transfer.",
    statutory: true
  },
  YELLOW: {
    id: "YELLOW",
    name: "Yellow",
    label: "Incinerable",
    color: "#C99312",
    swatch: "#FBF1DA",
    container: "Yellow non-chlorinated plastic bag",
    treatment: "Incineration at 850 °C or above, or plasma pyrolysis. Ash to sanitary landfill.",
    handlerRisk: 4,
    ppe: "Full PPE. Do not compress the bag.",
    statutory: true
  },
  BLUE: {
    id: "BLUE",
    name: "Blue",
    label: "Glass & metal",
    color: "#2E6FB7",
    swatch: "#DFEAF7",
    container: "Puncture-proof box with blue marking",
    treatment: "Disinfection or autoclaving, then authorised glass / metal recycler",
    handlerRisk: 3,
    ppe: "Cut-resistant gloves. Handle the container, not the contents.",
    statutory: true
  },
  RED: {
    id: "RED",
    name: "Red",
    label: "Contaminated recyclable",
    color: "#C0413A",
    swatch: "#F8E1E0",
    container: "Red non-chlorinated plastic bag or container",
    treatment: "Autoclave, microwave or hydroclave, then shred, then authorised recycler",
    handlerRisk: 2,
    ppe: "Standard gloves and apron.",
    statutory: true
  },
  BLACK: {
    id: "BLACK",
    name: "Black",
    label: "General",
    color: "#3B4444",
    swatch: "#E5E9E9",
    container: "Municipal waste bag",
    treatment: "Municipal Solid Waste Rules 2016 stream, strictly separated from clinical waste",
    handlerRisk: 1,
    ppe: "Standard gloves.",
    statutory: true
  },
  QUARANTINE: {
    id: "QUARANTINE",
    name: "Quarantine",
    label: "Held for review",
    color: "#71539C",
    swatch: "#EBE4F5",
    container: "Sealed internal compartment, authorised access only",
    treatment: "Held pending human adjudication, then released to the corrected stream",
    handlerRisk: 5,
    ppe: "Treat as sharps until adjudicated.",
    statutory: false
  }
};

// Escalation ladder used by R2. Index 0 is lowest handler risk.
const HAZARD_LADDER = ["BLACK", "RED", "BLUE", "YELLOW", "WHITE"];

// ---- Item classes -----------------------------------------------------
// `sharp: true` feeds the R1 veto. `cytotoxic: true` feeds R4.
// `massRange` is [min_g, max_g] for the load-cell sanity check in policy.js.
const ITEM_DB = {
  // ---- Sharps ----
  needle_loose:        { name: "Loose needle",           bin: "WHITE",  sharp: true,  massRange: [0.5, 6],    uses: "Hypodermic, suture, spinal" },
  syringe_with_needle: { name: "Syringe with needle",    bin: "WHITE",  sharp: true,  massRange: [3, 40],     uses: "Fixed-needle syringes, insulin pens" },
  iv_cannula:          { name: "IV cannula",             bin: "WHITE",  sharp: true,  massRange: [1, 8],      uses: "Peripheral venous access" },
  scalpel_blade:       { name: "Scalpel blade",          bin: "WHITE",  sharp: true,  massRange: [1, 15],     uses: "Surgical blades, detached handles" },
  lancet:              { name: "Lancet",                 bin: "WHITE",  sharp: true,  massRange: [0.3, 3],    uses: "Capillary blood sampling" },
  suture_needle:       { name: "Suture needle",          bin: "WHITE",  sharp: true,  massRange: [0.2, 4],    uses: "Wound closure" },

  // ---- Incinerable ----
  soiled_dressing:     { name: "Soiled dressing",        bin: "YELLOW", sharp: false, massRange: [2, 120],    uses: "Blood or fluid soaked dressings" },
  cotton_gauze:        { name: "Cotton / gauze",         bin: "YELLOW", sharp: false, massRange: [0.5, 40],   uses: "Swabs, cotton wool, gauze pieces" },
  anatomical_tissue:   { name: "Anatomical tissue",      bin: "YELLOW", sharp: false, massRange: [10, 5000],  uses: "Human tissue, organs, placenta" },
  expired_blister:     { name: "Expired medicine",       bin: "YELLOW", sharp: false, massRange: [1, 60],     uses: "Blister strips, discarded tablets" },
  drug_vial_residue:   { name: "Drug vial with residue", bin: "YELLOW", sharp: false, massRange: [3, 50],     uses: "Part-used vials, ampoules with drug" },
  cytotoxic_vial:      { name: "Cytotoxic vial",         bin: "YELLOW", sharp: false, cytotoxic: true, massRange: [3, 60], uses: "Chemotherapy drugs and their containers" },
  lab_culture_plate:   { name: "Lab culture plate",      bin: "YELLOW", sharp: false, massRange: [10, 90],    uses: "Petri dishes, specimen and stock cultures" },
  soiled_ppe:          { name: "Soiled PPE",             bin: "YELLOW", sharp: false, massRange: [3, 300],    uses: "Contaminated masks, gowns, caps, aprons" },
  soiled_linen:        { name: "Soiled linen",           bin: "YELLOW", sharp: false, massRange: [50, 2000],  uses: "Blood or fluid contaminated linen" },

  // ---- Contaminated recyclable ----
  syringe_no_needle:   { name: "Syringe, needle removed", bin: "RED",   sharp: false, massRange: [3, 40],     uses: "Barrel and plunger after needle destruction" },
  iv_tubing_set:       { name: "IV set / tubing",        bin: "RED",    sharp: false, massRange: [15, 120],   uses: "Infusion sets, extension lines" },
  iv_fluid_bottle:     { name: "IV fluid bottle",        bin: "RED",    sharp: false, massRange: [20, 150],   uses: "Emptied plastic saline and dextrose bottles" },
  urine_bag:           { name: "Urine bag",              bin: "RED",    sharp: false, massRange: [30, 250],   uses: "Emptied urine collection bags" },
  catheter:            { name: "Catheter",               bin: "RED",    sharp: false, massRange: [5, 80],     uses: "Urinary and vascular catheters" },
  glove:               { name: "Glove",                  bin: "RED",    sharp: false, massRange: [3, 20],     uses: "Examination and surgical gloves" },
  blood_bag_emptied:   { name: "Blood bag, emptied",     bin: "RED",    sharp: false, massRange: [20, 120],   uses: "Emptied blood and component bags" },
  suction_tubing:      { name: "Suction tubing",         bin: "RED",    sharp: false, massRange: [20, 200],   uses: "Suction lines and canister tubing" },

  // ---- Glass and metal ----
  glass_ampoule:       { name: "Glass ampoule",          bin: "BLUE",   sharp: false, massRange: [2, 20],     uses: "Emptied glass ampoules" },
  glass_vial_empty:    { name: "Empty glass vial",       bin: "BLUE",   sharp: false, massRange: [4, 40],     uses: "Fully emptied medicine vials" },
  glass_slide:         { name: "Glass slide",            bin: "BLUE",   sharp: false, massRange: [1, 10],     uses: "Microscope slides and coverslips" },
  broken_glassware:    { name: "Broken glassware",       bin: "BLUE",   sharp: false, massRange: [2, 200],    uses: "Broken laboratory and clinical glass" },
  metallic_implant:    { name: "Metallic implant",       bin: "BLUE",   sharp: false, massRange: [5, 400],    uses: "Removed plates, screws, prostheses" },

  // ---- General ----
  food_waste:          { name: "Food waste",             bin: "BLACK",  sharp: false, massRange: [5, 1000],   uses: "Uncontaminated kitchen and pantry waste" },
  paper_card:          { name: "Paper / cardboard",      bin: "BLACK",  sharp: false, massRange: [2, 500],    uses: "Office paper, clean cartons" },
  clean_packaging:     { name: "Clean packaging",        bin: "BLACK",  sharp: false, massRange: [1, 200],    uses: "Outer wrappers never in contact with patients" },

  // ---- Fallthrough ----
  unknown:             { name: "Unidentified item",      bin: "QUARANTINE", sharp: false, massRange: [0, 99999], uses: "Could not be identified with confidence" }
};

// Detector output order. class_map.json on the robot must match this exactly.
const CLASS_ORDER = Object.keys(ITEM_DB).filter((k) => k !== "unknown");

const SHARP_CLASSES = CLASS_ORDER.filter((k) => ITEM_DB[k].sharp);
const CLINICAL_CLASSES = CLASS_ORDER.filter((k) => ITEM_DB[k].bin !== "BLACK");
const CYTOTOXIC_CLASSES = CLASS_ORDER.filter((k) => ITEM_DB[k].cytotoxic);

// Reason codes for a human override in the review queue. Fixed vocabulary —
// free text is unauditable.
const REASON_CODES = {
  MISDETECT:      "Vision call was wrong",
  OCCLUDED:       "Item was hidden or overlapping",
  MULTI_ITEM:     "More than one item in frame",
  LABEL_UNCLEAR:  "Item genuinely ambiguous",
  POLICY_TOO_HOT: "Escalation rule was over-cautious",
  OTHER:          "Other, see note"
};

const WasteDB = { BINS, HAZARD_LADDER, ITEM_DB, CLASS_ORDER, SHARP_CLASSES, CLINICAL_CLASSES, CYTOTOXIC_CLASSES, REASON_CODES };

if (typeof module !== "undefined" && module.exports) module.exports = WasteDB;
else window.WasteDB = WasteDB;
