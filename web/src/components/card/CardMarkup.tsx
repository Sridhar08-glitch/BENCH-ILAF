// The card markup inside its `.cfl` wrapper, plus the stylesheets it needs. No hooks and no engine import, so it
// works as a server component (public page) and inside client components (editor preview).
//
// Loading order: the card stylesheet is hoisted into <head> with a precedence, which makes it render-blocking,
// so the card is never painted unstyled. The font stylesheet comes after the card in the body: a stylesheet
// in the body only holds back what follows it, so a slow font file never delays the card itself. The fonts are self-hosted (public/card-fonts), never fetched from a third party.
import type { CSSProperties } from "react";
import { CSS_URL } from "@/lib/library";
import { FONTS_CSS_URL } from "@/lib/library/generated/fonts";
import { TEXT_CSS } from "@/lib/library/text";
import { COMPANY_CSS } from "./company-css";

interface Props {
  html: string;
  pageVars: Record<string, string>;
  fullHeight?: boolean;
  thumb?: boolean;
  /** Company artwork classes for the wrapper (empty for personal cards). */
  wrapClass?: string;
}

export function CardMarkup({ html, pageVars, fullHeight, thumb, wrapClass }: Props) {
  // "tx-" classes come from the typeface and size settings, every other class from the company brand.
  const classes = (wrapClass ?? "").split(" ").filter(Boolean);
  const company = classes.some((c) => !c.startsWith("tx-"));
  const text = classes.some((c) => c.startsWith("tx-"));
  return (
    <>
      <link rel="stylesheet" href={CSS_URL} precedence="card-library" />
      {company ? <style href="card-library-company" precedence="card-library">{COMPANY_CSS}</style> : null}
      {text ? <style href="card-library-text" precedence="card-library">{TEXT_CSS}</style> : null}
      <div dir="ltr" className={`cfl${fullHeight ? " full" : ""}${thumb ? " thumb" : ""}${wrapClass ? " " + wrapClass : ""}`} style={pageVars as CSSProperties} dangerouslySetInnerHTML={{ __html: html }} />
      <link rel="stylesheet" href={FONTS_CSS_URL} />
    </>
  );
}
