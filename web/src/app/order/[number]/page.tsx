import type { Metadata } from "next";
import { OrderLookup } from "./OrderLookup";
import { getI18n } from "@/lib/i18n/server";

type Props = { params: Promise<{ number: string }>; searchParams: Promise<{ phone?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { number } = await params;
  const { t } = await getI18n();
  return { title: t("commerce.statusPageTitle", { number: decodeURIComponent(number) }), robots: { index: false, follow: false } };
}

export default async function OrderPage({ params, searchParams }: Props) {
  const { number } = await params;
  const sp = await searchParams;
  return <OrderLookup number={decodeURIComponent(number)} initialPhone={typeof sp.phone === "string" ? sp.phone : ""} />;
}
