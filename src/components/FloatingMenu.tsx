import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** LANX 2.0.1: a menu that opens under its button but is drawn at the top of
 *  the page, so the panel the button sits in (a chat's top bar, with its
 *  rounded, clipped glass) can never cut it off. It stays inside the window
 *  and closes on Esc or a click anywhere else (the button itself toggles it). */
export function FloatingMenu({
  anchor,
  onClose,
  className,
  children,
  ...data
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  children: ReactNode;
  [attr: `data-${string}`]: string | boolean | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(8, Math.min(a.right - w, window.innerWidth - w - 8));
      let top = a.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
      setPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onCloseRef.current();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", esc);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      {...data}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
      className={`fixed z-[60] ${className ?? ""}`}
    >
      {children}
    </div>,
    document.body
  );
}
