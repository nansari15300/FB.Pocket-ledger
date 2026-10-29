import type { DaybookWedgeSnapshot, DaybookWedgeSummary } from "@wedge/daybook/types/daybookWedgeRow";

/** Daybook app colors — blue summary card, emerald card border, green/red amounts. */
export const DAYBOOK_WEDGE_THEME = {
  bg: "#F8FAFC",
  cardBorder: "#6EE7B7",
  cardBorderPending: "#F9A8D4",
  cardBg: "#FFFFFF",
  cardBgPending: "#FDF2F8",
  title: "#0F172A",
  muted: "#64748B",
  summaryBg: "#EFF6FF",
  summaryBorder: "#BFDBFE",
  summaryTitle: "#1E3A8A",
  summarySub: "#1D4ED8",
  /** Table row lines — header 2px, rows 1px (daybook jaisa). */
  summaryTableLine: "#0F172A",
  green: "#16A34A",
  red: "#DC2626",
  accent: "#0D9488",
  divider: "#E2E8F0",
  toolbarBg: "#DBEAFE",
} as const;

/** Fixed ISO dates so SSR and client render the same sample tree. */
const SAMPLE_TODAY_ISO = "2026-08-21T00:00:00.000Z";
const SAMPLE_YESTERDAY_ISO = "2026-08-20T00:00:00.000Z";

const sampleRows = [
  {
    id: "1",
    voucherNumber: "PYMT - 0266",
    typeLabel: "payment",
    partyLine: "Ansarul Hak",
    amountLine: "1,00,000",
    sortKey: new Date(SAMPLE_TODAY_ISO).setHours(10, 30, 0, 0),
    titleLine: "PYMT - 0266 · payment · Ansarul Hak",
    narrationLine: "Narration : 1,00,000",
    metaLine: "08-21-2026 · 2083-05-05 • 10:30 AM",
    balanceLine: "Bal: 1,53,26,422.80Cr",
    amountColor: "out" as const,
    showMenu: true,
    showFile: true,
    isPendingApproval: true,
    timePart: "10:30 AM",
  },
  {
    id: "2",
    voucherNumber: "CNTR - 0001",
    typeLabel: "contra",
    partyLine: "Cash",
    amountLine: "54,000",
    sortKey: new Date(SAMPLE_TODAY_ISO).setHours(9, 15, 0, 0),
    titleLine: "CNTR - 0001 · contra · Cash",
    narrationLine: "Narration : Cash to bank",
    metaLine: "08-21-2026 · 2083-05-05 • 9:15 AM",
    balanceLine: "Bal: 34,91,857.00Dr",
    amountColor: "in" as const,
    showMenu: false,
    showFile: false,
    isPendingApproval: false,
    timePart: "9:15 AM",
  },
];

const sampleSummary: DaybookWedgeSummary = {
  bankYesterday: 3491857,
  bankIn: 54000,
  bankOut: 140016,
  bankToday: 3405841,
  cashYesterday: 50000,
  cashIn: 0,
  cashOut: 54000,
  cashToday: -4000,
  totalYesterday: 3541857,
  totalIn: 54000,
  totalOut: 194016,
  totalToday: 3401841,
  bankAccounts: [
    { id: "b1", name: "Aftab Alam Nic Asia bank", yesterday: 1200000, in: 30000, out: 80000, today: 1150000 },
    { id: "b2", name: "Clearing Account", yesterday: 500000, in: 10000, out: 20000, today: 490000 },
    { id: "b3", name: "Himalayan Bank Limited", yesterday: 1791857, in: 14000, out: 40016, today: 1765841 },
  ],
  cashAccounts: [
    { id: "c1", name: "Cash In Hand", yesterday: 50000, in: 0, out: 54000, today: -4000 },
  ],
};

export const DAYBOOK_WEDGE_SAMPLE: DaybookWedgeSnapshot = {
  version: 1,
  wedgeId: "daybook",
  companyId: "demo",
  companyName: "New Parsa i 82-83",
  updatedAt: 0,
  defaultDayIso: SAMPLE_TODAY_ISO,
  selectedDayIso: SAMPLE_TODAY_ISO,
  selectedDayLabel: "08-21-2026 / 2083-05-05",
  summary: sampleSummary,
  rows: sampleRows,
  dateSystem: "Both",
  isNepalCalendar: true,
  companies: [
    { id: "demo", name: "New Parsa i 82-83" },
    { id: "demo2", name: "Demo Company 2" },
  ],
  voucherCount: sampleRows.length,
  days: [
    {
      dayIso: SAMPLE_TODAY_ISO,
      dayLabel: "08-21-2026 / 2083-05-05",
      summary: sampleSummary,
      rows: sampleRows,
      voucherCount: sampleRows.length,
    },
    {
      dayIso: SAMPLE_YESTERDAY_ISO,
      dayLabel: "08-20-2026 / 2083-05-04",
      summary: {
        ...sampleSummary,
        totalIn: 54000,
        totalOut: 54000,
      },
      rows: [sampleRows[1]],
      voucherCount: 1,
    },
  ],
};

export function formatDaybookWedgeSummaryLine(summary: DaybookWedgeSummary): string {
  return `In ${Math.round(summary.totalIn)}  Out ${Math.round(summary.totalOut)}  Bal ${Math.round(summary.totalToday)}`;
}

export function formatSummaryMoney(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}
