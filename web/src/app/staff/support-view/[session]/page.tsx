"use client";

import { use } from "react";
import { SupportMirror } from "@/components/staff-admin/SupportView";

export default function Page({ params }: { params: Promise<{ session: string }> }) {
  const { session } = use(params);
  return <SupportMirror sid={session} />;
}
