"use client";

import type { Label } from "@slipstream/protocol";
import styles from "./label-chips.module.css";

export function LabelChips({
  allLabels,
  activeIds,
  onToggle,
}: {
  allLabels: Label[];
  activeIds: string[];
  onToggle: (id: string) => void;
}): React.JSX.Element {
  if (allLabels.length === 0) {
    return <p className={styles.empty}>No labels in this project yet. Create one below.</p>;
  }
  return (
    <ul className={styles.chips}>
      {allLabels.map((l) => {
        const on = activeIds.includes(l.id);
        return (
          <li key={l.id}>
            <button
              type="button"
              className={styles.chip}
              data-on={on ? "true" : "false"}
              onClick={() => onToggle(l.id)}
              aria-pressed={on}
              style={{ ["--label-colour" as string]: l.colour }}
            >
              <span className={styles.swatch} aria-hidden />
              {l.name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
