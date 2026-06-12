"use client";

import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Issue } from "@slipstream/protocol";
import styles from "./virtual-issue-list.module.css";

/**
 * Window-virtualised list. Renders only the issue rows currently in (or near)
 * the viewport, so a project with thousands of issues stays scroll-responsive
 * without the engine or React doing extra work.
 *
 * Row height estimate (44px) covers the default IssueRow on a default-DPI
 * monitor. The virtualiser remeasures any row that ends up taller, so this is
 * a hint, not a contract.
 *
 * The outer scroll container is `role="presentation"` because the inner <ul>
 * carries the list semantics; this prevents the wrapper from being read as a
 * generic container.
 */
export function VirtualIssueList({
  issues,
  ariaLabel,
  renderRow,
}: {
  issues: Issue[];
  ariaLabel: string;
  renderRow: (issue: Issue, index: number) => ReactNode;
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: issues.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 6,
    getItemKey: (idx) => issues[idx]!.id,
  });

  const items = rowVirtualizer.getVirtualItems();

  return (
    <div ref={scrollRef} className={styles.scroll} role="presentation">
      <ul
        className={styles.list}
        aria-label={ariaLabel}
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {items.map((vi) => {
          const issue = issues[vi.index];
          if (!issue) return null;
          return (
            <li
              key={vi.key}
              ref={rowVirtualizer.measureElement}
              data-index={vi.index}
              className={styles.row}
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              {renderRow(issue, vi.index)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
