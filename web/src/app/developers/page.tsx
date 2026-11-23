import type { Metadata } from "next";
import { APP_NAME } from "@/lib/config";
import {
  ENDPOINTS, ERROR_EXAMPLE, ETAG_EXAMPLE, IDEM_EXAMPLE, LIMIT_HEADERS, PAGE_EXAMPLE, PUBLIC_API_URL, QUICK_CURL,
} from "@/lib/dev/examples";
import { HEADERS, VERIFY_NODE, VERIFY_PYTHON } from "@/lib/crm/webhooks";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("dev.g.metaTitle"), description: t("dev.g.lead") };
}

// Drawn per request so the page follows the visitor's language.
export const dynamic = "force-dynamic";

const code = { direction: "ltr" as const, textAlign: "left" as const, background: "#101114", color: "#f4f4f5", padding: 14, borderRadius: 10, overflowX: "auto" as const, fontSize: 13, lineHeight: 1.5 };
const box = { maxWidth: 860, margin: "0 auto", padding: "32px 16px 80px", fontFamily: "var(--font-poppins), var(--font-plex-ar), sans-serif", color: "#101114" };

export default async function DevelopersPage() {
  const { t } = await getI18n();
  const nav = [
    ["quick", t("dev.g.navQuick")], ["auth", t("dev.g.navAuth")], ["errors", t("dev.g.navErrors")], ["limits", t("dev.g.navLimits")],
    ["paging", t("dev.g.navPaging")], ["idem", t("dev.g.navIdem")], ["etag", t("dev.g.navEtag")], ["hooks", t("dev.g.navHooks")],
    ["endpoints", t("dev.g.navEndpoints")], ["changelog", t("dev.g.navChange")],
  ];
  return (
    <main style={box}>
      <p style={{ fontWeight: 700, color: "#FF6B35" }}>{APP_NAME}</p>
      <h1>{t("dev.g.title")}</h1>
      <p>{t("dev.g.lead")}</p>
      <p><a href={`${PUBLIC_API_URL}/openapi.json`}>{t("dev.g.openapi")}</a></p>
      <nav aria-label={t("dev.g.title")} style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "16px 0 32px" }}>
        {nav.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>

      <section id="quick">
        <h2>{t("dev.g.quickTitle")}</h2>
        <ol>
          <li>{t("dev.g.quick1")}</li>
          <li>{t("dev.g.quick2")}<pre style={code}>{QUICK_CURL}</pre></li>
          <li>{t("dev.g.quick3")}</li>
        </ol>
      </section>

      <section id="auth"><h2>{t("dev.g.authTitle")}</h2><p>{t("dev.g.authText")}</p><p>{t("dev.g.authIp")}</p></section>
      <section id="errors"><h2>{t("dev.g.errTitle")}</h2><p>{t("dev.g.errText")}</p><pre style={code}>{ERROR_EXAMPLE}</pre><p dir="ltr" style={{ textAlign: "start" }}>{t("dev.g.errCodes")}</p></section>
      <section id="limits"><h2>{t("dev.g.limitTitle")}</h2><p>{t("dev.g.limitText")}</p><pre style={code}>{LIMIT_HEADERS}</pre></section>
      <section id="paging"><h2>{t("dev.g.pageTitle")}</h2><p>{t("dev.g.pageText")}</p><pre style={code}>{PAGE_EXAMPLE}</pre></section>
      <section id="idem"><h2>{t("dev.g.idemTitle")}</h2><p>{t("dev.g.idemText")}</p><pre style={code}>{IDEM_EXAMPLE}</pre></section>
      <section id="etag"><h2>{t("dev.g.etagTitle")}</h2><p>{t("dev.g.etagText")}</p><pre style={code}>{ETAG_EXAMPLE}</pre></section>

      <section id="hooks">
        <h2>{t("dev.g.hooksTitle")}</h2>
        <p>{t("dev.g.hooksText")}</p>
        <ul dir="ltr" style={{ textAlign: "left" }}>{HEADERS.map((h) => <li key={h.name}><code>{h.name}</code></li>)}</ul>
        <h3>Node.js</h3><pre style={code}>{VERIFY_NODE}</pre>
        <h3>Python</h3><pre style={code}>{VERIFY_PYTHON}</pre>
      </section>

      <section id="endpoints">
        <h2>{t("dev.g.epTitle")}</h2>
        <p>{t("dev.g.epText")}</p>
        {ENDPOINTS.map((e) => (
          <article key={e.method + e.path} style={{ margin: "20px 0" }}>
            <h3 dir="ltr" style={{ textAlign: "start", fontSize: 16 }}><code>{e.method} {e.path}</code></h3>
            <p>{t(e.text)} <small>({e.scope ? t("dev.g.scope", { scope: e.scope }) : t("dev.g.noScope")})</small></p>
            <pre style={code}>{e.example}</pre>
          </article>
        ))}
      </section>

      <section id="changelog"><h2>{t("dev.g.changeTitle")}</h2><ul><li>{t("dev.g.change1")}</li></ul></section>
    </main>
  );
}
