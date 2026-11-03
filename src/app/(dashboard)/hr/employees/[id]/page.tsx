import { EmployeeIdRouteClient } from "./EmployeeIdRouteClient";

export async function generateStaticParams() {
  // "new" = Add Employee (static export me real page); baaki ids loans jaisa placeholder pattern.
  return [{ id: "__placeholder__" }, { id: "new" }];
}

export default function HrEmployeeIdRoutePage() {
  return <EmployeeIdRouteClient />;
}
