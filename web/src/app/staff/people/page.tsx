// Suspense lets the page read ?q= and ?user= from the address.
import { Suspense } from "react";
import People from "@/components/staff-admin/People";

export default function Page() {
  return <Suspense><People /></Suspense>;
}
