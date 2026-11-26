// Dragging the company logo on the live preview. The preview is drawn elsewhere on the page, so this listens on the document for a drag
// that starts on the logo (data-co="free") and reports the new place (left and top in percent of the card) when the drag ends.
export function listenLogoDrag(commit: (x: number, y: number, height: number) => void): () => void {
  document.documentElement.setAttribute("data-logo-drag", "1");
  const down = (e: PointerEvent) => {
    const el = (e.target as Element | null)?.closest?.('[data-co="free"]') as HTMLElement | null;
    const host = el?.closest(".face, .pg-top") as HTMLElement | null;
    if (!el || !host) return;
    e.preventDefault();
    e.stopPropagation();
    const area = host.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const h = (box.height / area.height) * 100;
    const w = (box.width / area.width) * 100;
    const x0 = parseFloat(el.style.left) || 0;
    const y0 = parseFloat(el.style.top) || 0;
    let nx = x0;
    let ny = y0;
    const move = (ev: PointerEvent) => {
      nx = Math.min(100 - w, Math.max(0, x0 + ((ev.clientX - e.clientX) / area.width) * 100));
      ny = Math.min(100 - h, Math.max(0, y0 + ((ev.clientY - e.clientY) / area.height) * 100));
      el.style.left = `${nx}%`;
      el.style.top = `${ny}%`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      commit(nx, ny, h);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  document.addEventListener("pointerdown", down, true);
  return () => {
    document.removeEventListener("pointerdown", down, true);
    document.documentElement.removeAttribute("data-logo-drag");
  };
}
