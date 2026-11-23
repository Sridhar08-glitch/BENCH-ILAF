"use client";

import { use } from "react";
import CompanyDetail from "@/components/staff-admin/CompanyDetail";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CompanyDetail id={id} />;
}
