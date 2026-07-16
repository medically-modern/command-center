/**
 * benefitsDemo.ts — the prototype's demo scenario tabs, ported for testing.
 *
 * Each scenario builds a LOCAL, synthetic "Bob Jones [TEST]" patient
 * (benefits-redesign.html SCENARIOS, verbatim data) so every payer/serving
 * combination and its derivation logic can be exercised against the Monday
 * Board Output drawer WITHOUT touching a real patient. Demo patients live
 * only in page state — the send button never writes them to Monday.
 *
 * TESTING AID: strip together with the Board Output drawer for production
 * (spec §6/§8). The BlueCard / POS-11 scenarios' special logic (who-to-call
 * pills, out-of-network flag) is blocked on the Anthem rulebook (D7) — those
 * tabs still exercise the standard commercial derivations.
 */
import type { Patient } from "./workflow";
import { EMPTY_INSURANCE } from "./workflow";

export interface BenefitsDemoScenario {
  key: string;
  label: string;
  build: () => Patient;
}

interface ScenarioSpec {
  key: string;
  label: string;
  primary: string;
  secondary: string;
  serving: string;
  memberId2: string;
  address?: string;
  stedi: {
    planBegin: string;
    planName: string;
    qmb: string;
    coins: string;
    ded: string;
    oop: string;
  };
}

const SPECS: ScenarioSpec[] = [
  {
    key: "commercial",
    label: "Commercial · IP + CGM",
    primary: "Horizon BCBS",
    secondary: "None",
    serving: "Insulin Pump + CGM",
    memberId2: "",
    stedi: { planBegin: "2026-01-01", planName: "Horizon PPO Advantage", qmb: "No", coins: "20%", ded: "$350", oop: "$1,850" },
  },
  {
    key: "medicare",
    label: "Medicare A&B",
    primary: "Medicare A&B",
    secondary: "None",
    serving: "Insulin Pump + CGM",
    memberId2: "",
    stedi: { planBegin: "2025-07-01", planName: "Medicare A&B", qmb: "No", coins: "20%", ded: "$57", oop: "—" },
  },
  {
    key: "managed-mcd",
    label: "Managed Medicaid · Pump",
    primary: "Fidelis Medicaid",
    secondary: "NY Medicaid",
    serving: "Insulin Pump",
    memberId2: "EC81836D",
    stedi: { planBegin: "2026-03-01", planName: "Fidelis Medicaid Managed Care", qmb: "No", coins: "0%", ded: "$0", oop: "$0" },
  },
  {
    key: "bluecard",
    label: "BlueCard · CT Home Plan",
    primary: "Anthem BCBS Commercial",
    secondary: "None",
    serving: "Insulin Pump + CGM",
    memberId2: "",
    stedi: { planBegin: "2025-11-01", planName: "Anthem Blue Access PPO", qmb: "No", coins: "10%", ded: "$120", oop: "$2,400" },
  },
  {
    key: "pos11",
    label: "Out-of-State · POS 11",
    primary: "Anthem BCBS Commercial",
    secondary: "None",
    serving: "Insulin Pump + CGM",
    memberId2: "",
    address: "4821 Cedar Springs Rd, Dallas, TX 75219",
    stedi: { planBegin: "2026-02-01", planName: "Blue Cross Blue Shield of Texas PPO", qmb: "No", coins: "20%", ded: "$600", oop: "$3,000" },
  },
];

function buildDemoPatient(spec: ScenarioSpec): Patient {
  return {
    id: `demo-${spec.key}`,
    name: "Bob Jones [TEST]",
    dob: "2025-01-01",
    product: "CGM",
    payer: spec.primary,
    doctorName: "Michael Greenberg",
    doctorClinic: "1180 Morris Park Avenue, Bronx, NY 10461",
    doctorPhone: "1 (844) 556-6683",
    doctorNpi: "1679847545",
    doctorFax: "(718) 555-0142",
    doctorEmail: "mgreenberg@einstein.edu",
    clinicalsMethod: "Parachute",
    clinicName: "1180 Morris Park Avenue, Bronx, NY 10461",
    contactMethod: "parachute",
    stage: "advanced",
    pillars: {},
    pathwayChecks: {},
    chaseStep: 0,
    faxPhase: 1,
    notes: "",
    receivedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    owner: "Samantha",
    serving: spec.serving as Patient["serving"],
    primaryInsurance: spec.primary as Patient["primaryInsurance"],
    secondaryInsurance: spec.secondary,
    diagnosis: "E11.65",
    memberId1: "YHQ3HZN33099920",
    memberId2: spec.memberId2,
    referralSource: "Patient",
    patientPhone: "(914) 220-2922",
    patientAddress: spec.address ?? "2093 Wantagh Ave, Wantagh, NY 11793",
    pumpBrand: "Tandem t:slim X2",
    planName: spec.stedi.planName,
    stediQmb: spec.stedi.qmb,
    stediCoinsurance: spec.stedi.coins,
    stediPlanBegin: spec.stedi.planBegin,
    deductibleRemaining: spec.stedi.ded,
    oopMaxRemaining: spec.stedi.oop,
    insurance: structuredClone(EMPTY_INSURANCE),
  };
}

export const BENEFITS_DEMO_SCENARIOS: BenefitsDemoScenario[] = SPECS.map((spec) => ({
  key: spec.key,
  label: spec.label,
  build: () => buildDemoPatient(spec),
}));

export function isDemoPatient(p: Patient | undefined | null): boolean {
  return !!p && p.id.startsWith("demo-");
}
