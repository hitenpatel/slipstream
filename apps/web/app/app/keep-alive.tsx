"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./keep-alive.module.css";

/**
 * The manual equivalent of React 19.2's experimental <Activity mode="hidden">.
 * Both children stay mounted; the inactive subtree is hidden via CSS and
 * marked inert so it doesn't steal focus, get clicked through, or be reachable
 * by screen readers.
 *
 * We're not using the experimental import directly because we're on React
 * 19.0; this keeps the same observable behaviour without a stable-channel
 * requirement. Scroll position is preserved because the inactive subtree is
 * still in the layout tree (just hidden), so its overflow:auto containers
 * retain their scrollTop across switches.
 *
 * The `inert` attribute does the heavy lifting: it removes the subtree from
 * the tab order, prevents pointer events, and hides the content from a11y
 * tools. Browsers ≥ Firefox 112 / Chrome 102 / Safari 16.4 all support it.
 */
export function KeepAlive({
  active,
  children,
  label,
}: {
  active: boolean;
  children: ReactNode;
  /** Used for the wrapping container's aria-label so AT users get the right name. */
  label?: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  // `inert` is a boolean HTML attribute; React 19 reflects it onto the DOM,
  // but we set it imperatively so older runtimes still get the property.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (active) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [active]);

  return (
    <div
      ref={ref}
      aria-label={label}
      className={styles.frame}
      data-active={active ? "true" : "false"}
      // The mounted-but-inactive frame is `aria-hidden` so SR users only hear
      // the active view's content. `inert` already does this, but we set both
      // for older browsers that may handle one but not the other.
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}
