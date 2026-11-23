import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// There is no marketing page in front of the app: the address root sends visitors straight to the
// dashboard when they are signed in and to the sign-in page when they are not.
export const dynamic = "force-dynamic";

export default async function Home() {
  const jar = await cookies();
  const signedIn = jar.has("ilaf_rt") || jar.has("ilaf_at");
  redirect(signedIn ? "/app" : "/login");
}
