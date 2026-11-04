import { SlipIdRouteClient } from "./SlipIdRouteClient";

/** Static export: placeholder shell; asli id client par `useParams` se. */
export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

export default function HrPayrollSlipRoutePage() {
  return <SlipIdRouteClient />;
}
