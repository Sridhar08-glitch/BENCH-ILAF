"use client";

import { use } from "react";
import { CardEditor } from "@/components/editor/CardEditor";

export default function EditCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CardEditor id={id} />;
}
