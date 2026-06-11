"use client";

import type { Label } from "@slipstream/protocol";
import styles from "./label-dots.module.css";

/** Tiny inline list of label chips for use inside rows and board cards. */
export function LabelDots({
  labelIds,
  labels,
  max = 3,
}: {
  labelIds: string[];
  labels: Label[];
  max?: number;
}): React.JSX.Element | null {
  if (labelIds.length === 0) return null;
  const byId = new Map(labels.map((l) => [l.id, l] as const));
  const shown: Label[] = [];
  for (const id of labelIds) {
    const l = byId.get(id);
    if (l) shown.push(l);
    if (shown.length >= max) break;
  }
  if (shown.length === 0) return null;
  const overflow = labelIds.length - shown.length;
  return (
    <span className={styles.row}>
      {shown.map((l) => (
        <span
          key={l.id}
          className={styles.dot}
          title={l.name}
          aria-label={`Label ${l.name}`}
          style={{ background: l.colour }}
        />
      ))}
      {overflow > 0 ? <span className={styles.more}>+{overflow}</span> : null}
    </span>
  );
}
