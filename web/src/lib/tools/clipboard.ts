// Copy rich HTML (with a plain-text fallback) so pasting into a mail app's signature box keeps the design.
// Modern browsers take both kinds at once; older ones copy the rendered HTML through a selection.

/** Copy HTML and text together. Returns false when the browser refused. */
export async function copyRich(html: string, text: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    /* fall through to the selection method */
  }
  return copyBySelection(html);
}

/** Plain text copy (used for the HTML source). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;inset-block-start:0;inset-inline-start:-9999px;opacity:0;";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

function copyBySelection(html: string): boolean {
  const box = document.createElement("div");
  box.contentEditable = "true";
  box.style.cssText = "position:fixed;inset-block-start:0;inset-inline-start:-9999px;opacity:0;";
  box.innerHTML = html;
  document.body.appendChild(box);
  const range = document.createRange();
  range.selectNodeContents(box);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  sel?.removeAllRanges();
  box.remove();
  return ok;
}
