"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { PresenceFocus } from "@slipstream/protocol";
import { useEngine } from "./engine-provider";

/**
 * Derive the current `PresenceFocus` from the URL and publish it through the
 * engine, debounced to one publish per route change. Mounted once at the top
 * of the app shell.
 *
 *   - On /app/[projectId]/...           → { kind: "project", id }
 *   - On /app/[projectId]/?issue=ID     → { kind: "issue", id }
 *   - Otherwise                         → null
 */
export function usePublishFocus(): void {
  const { engine } = useEngine();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    const focus = deriveFocus(pathname, params.get("issue"));
    engine.publishFocus(focus);
    // engine identity is stable, so we only re-fire on the inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, params.get("issue")]);
}

function deriveFocus(pathname: string, issueId: string | null): PresenceFocus {
  if (issueId) return { kind: "issue", id: issueId };
  const m = pathname.match(/^\/app\/([^/]+)/);
  if (m?.[1]) return { kind: "project", id: m[1] };
  return null;
}
