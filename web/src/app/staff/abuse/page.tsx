// Suspense lets the page read the ?open= address of a report.
import { Suspense } from "react";
import Abuse from "@/components/staff-admin/Abuse";

export default function Page() {
  return <Suspense><Abuse /></Suspense>;
}
