export * from "./types";
/** FUTURE (pl_hr server routes): not called by the HR UI; HR data lives in staff.hr + pl_docs. */
export {
  hrApi,
  HrDisabledError,
  isHrDisabledError,
  getHrStatus,
  listHr,
  upsertHr,
  deleteHr,
  decideLeave,
  postPayroll,
  newHrAppId,
} from "./services/hrApi";
export {
  HR_DOC_COLLECTIONS,
  listHrDocs,
  getHrDoc,
  writeHrDocs,
  subscribeHrDocs,
  newHrDocId,
} from "./services/hrDocs";
export type { HrDocKind, HrDocWriteInput } from "./services/hrDocs";
export { writeStaffHrFields, HR_STAFF_OVERLAY_EVENT } from "./services/hrStaffWrite";
export { HrGate } from "./components/HrGate";
export { HrTable, HrTableHeader, HR_TABLE_LINES, HR_TABLE_HEADER, HR_TABLE_ROW, HR_TABLE_FRAME } from "./components/HrTable";
export { useHrEmployees, classifyStaffForHr } from "./hooks/useHrEmployees";
export type { HrStaffKind } from "./hooks/useHrEmployees";
export { useHrAttendance } from "./hooks/useHrAttendance";
export type { HrAttendanceMark, UseHrAttendanceParams } from "./hooks/useHrAttendance";
export * from "./utils/attendance";
export { useHrLeaves } from "./hooks/useHrLeaves";
export type { HrLeaveRequestInput, UseHrLeavesParams } from "./hooks/useHrLeaves";
export * from "./utils/leaves";
export { useHrModuleFeature } from "@/hooks/useHrModuleFeature";
export * from "./payroll";
