import { EmployeeIdRouteClient } from "./EmployeeIdRouteClient";

export async function generateStaticParams() {
  // Static export ke liye placeholder ids; route ab sirf /hr/employees par redirect karta hai.
  return [{ id: "__placeholder__" }, { id: "new" }];
}

export default function HrEmployeeIdRoutePage() {
  return <EmployeeIdRouteClient />;
}
