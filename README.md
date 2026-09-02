# MedWaste AI — ward segregation console

Phase 1 and 2 of the PS 26115 migration plan: the policy layer, the waste
knowledge base, the hash-chained ledger, and the PWA reskinned around them.
Runs against a mock robot fleet, so the whole thing is demonstrable with
zero hardware.

## Run

```bash
cd medwaste-ai
python3 -m http.server 8000
# http://localhost:8000
```

```bash
node js/policy.test.js     # 25 safety rules, no browser needed
```

## What is real

**The policy layer is the point.** `js/policy.js` is a pure, deterministic
function sitting between the detector and the diverter. It is fully specified
by `js/policy.test.js`, which runs in Node with no model, no camera and no
robot. Five rules:

| Rule | Behaviour |
|---|---|
| R1 | Sharps veto — `P(sharp) > 0.15`, or unexplained metal, routes to White regardless of the detector's top call |
| R2 | Never downgrade — general waste needs ≥90% confidence *and* <5% clinical evidence, else escalate |
| R3 | Split decisions quarantine — top-2 spanning different bins with <25% margin does not actuate a diverter |
| R4 | Cytotoxic lock — separately labelled liner, flagged, never mixed |
| R5 | No inference without a model — refuse, lock intake, seal contents, return to dock |

R5 is evaluated first and is the deliberate inversion of the old app's
brightness-and-saturation fallback. The machine refuses rather than guesses.

**Sensor fusion.** Vision, an inductive metal proximity sensor and a load
cell are three independent signals. When they disagree, the item is
quarantined — see `Policy.fuse`. The metal sensor is what catches a needle
that vision called a glove.

**Hash-chained ledger.** `js/ledger.js` is append-only. Records are never
edited; a correction is a new `Adjudication` event that supersedes an earlier
one, and both survive. Each record carries the SHA-256 of the one before it,
so a retroactive edit breaks the chain and `Ledger.verify()` reports the
sequence number where. Hit the link icon on the Ledger screen to run it.

**Bag identity** follows the CPCB bar code label format:
`ALLIN 110029 DL BH 00578` + sequential — 5-letter HCF code, 6-digit pincode,
2-letter state, 2-letter facility type, 5-digit facility number.

**Roles are functional.** Overriding a hazardous classification requires the
waste manager role and always records who did it. Switch roles in Settings to
see the review controls disappear.

## Try this

1. **Intake** → Run intake ten times. The scripted scenarios walk every rule
   in order: PASS, R1, PASS, R2, R4, R3, PASS, PASS, R1, R5.
2. Set **Model status** to `unavailable` and run again — R5 fires, intake
   locks, the unit heads for the dock.
3. **Review queue** → open a quarantined item → Override → pick a bin and a
   reason code. Reopen the record: the original decision is still there with
   the correction layered on top.
4. **Ledger** → link icon → chain verification.
5. **Fleet** → any unit → compartment fill, faults, emergency stop.

## Not yet built

- Real detector. `js/mock-robot.js` replays scripted detections. The shapes
  it emits are the `POST /v1/classifications` contract, so when the edge
  device arrives this file is deleted, not rewritten.
- Backend. The ledger is local, with an outbox that queues writes when
  offline. `Ledger.flush(post)` takes the real transport.
- Form IV export and CBWTF reconciliation. `Ledger.totals()` has the data;
  the report templates are not written.
- Camera QR scanning for bag handover. The capture pipeline from
  PlasticDetect transfers directly.

## Layout

```
medwaste-ai/
├── index.html
├── manifest.json / service-worker.js
├── css/styles.css          # clinical palette, both themes
└── js/
    ├── waste-db.js         # 24 item classes → 6 destinations, BMWM data
    ├── policy.js           # R1–R5 + sensor fusion, pure
    ├── policy.test.js      # 25 tests, node js/policy.test.js
    ├── ledger.js           # append-only hash chain, outbox, roles, bag labels
    ├── mock-robot.js       # fleet telemetry + scripted intake scenarios
    └── app.js              # screens, all DOM
```

## Carried over from PlasticDetect AI

PWA shell and service worker, the token/theme CSS architecture, bottom nav,
sheet and snackbar, and the module boundary where the UI knows only a
decision's shape and nothing about how it was produced.

Fixed on the way across: `localStorage` writes are now guarded and degrade to
memory instead of throwing `QuotaExceededError`; all interpolated values are
escaped; the no-op save button, the fake flash toggle and the confetti are
gone.
