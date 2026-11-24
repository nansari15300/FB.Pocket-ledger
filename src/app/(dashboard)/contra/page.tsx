import { redirect } from "next/navigation";

/** The standalone Contra ledger was retired; open its report instead. */
export default function ContraPage() {
  redirect("/reports?report=contra");
}
