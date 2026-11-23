"use client";

import { useEffect, useRef, useState } from "react";

/** True while the element is near the screen (and always where the browser cannot tell), so a long list only draws what is around the viewer. */
export function useVisible<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setSeen(entries[entries.length - 1].isIntersecting), { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}
