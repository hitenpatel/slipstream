"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Issue, IssueStatus, Label } from "@slipstream/protocol";
import { useEngine } from "../../engine-provider";
import { STATUS_LABEL, applyFilters, useFilters } from "../filters";
import { useProjectData } from "../hooks";
import { LabelDots } from "../label-dots";
import styles from "./board-view.module.css";

const COLUMN_ORDER: IssueStatus[] = ["backlog", "todo", "in_progress", "done", "cancelled"];

export function BoardView({ projectId }: { projectId: string }): React.JSX.Element {
  const { engine } = useEngine();
  const { project, issues, labels } = useProjectData(projectId);
  const filters = useFilters();
  const router = useRouter();
  const params = useSearchParams();

  const filtered = applyFilters(issues, filters);

  const columns = useMemo(() => {
    const map: Record<IssueStatus, Issue[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      done: [],
      cancelled: [],
    };
    for (const issue of filtered) map[issue.status].push(issue);
    // already sorted by position by the hook
    return map;
  }, [filtered]);

  function openIssue(issueId: string): void {
    const next = new URLSearchParams(params.toString());
    next.set("issue", issueId);
    router.replace(`?${next.toString()}`);
  }

  async function moveTo(issueId: string, status: IssueStatus): Promise<void> {
    const issue = issues.find((i) => i.id === issueId);
    if (!issue || issue.status === status) return;
    // place at the end of the destination column with a new fractional key
    const dest = columns[status];
    const lastPosition = dest[dest.length - 1]?.position ?? null;
    const { between } = await import("@slipstream/protocol");
    const position = between(lastPosition, null);
    await engine.mutate("moveIssue", { id: issueId, status, position });
    void engine.sync();
  }

  if (!project) {
    return <main className={styles.empty}>Project not found.</main>;
  }

  return (
    <main className={styles.board}>
      {COLUMN_ORDER.map((status) => (
        <Column
          key={status}
          status={status}
          issues={columns[status]}
          labels={labels}
          onOpen={openIssue}
          onMove={moveTo}
        />
      ))}
    </main>
  );
}

function Column({
  status,
  issues,
  labels,
  onOpen,
  onMove,
}: {
  status: IssueStatus;
  issues: Issue[];
  labels: Label[];
  onOpen: (id: string) => void;
  onMove: (id: string, to: IssueStatus) => void;
}): React.JSX.Element {
  return (
    <section className={styles.column} aria-labelledby={`col-h-${status}`}>
      <header className={styles.colHeader}>
        <h2 id={`col-h-${status}`} className={styles.colTitle}>
          {STATUS_LABEL[status]}
        </h2>
        <span className={styles.colCount} aria-label={`${issues.length} issues`}>
          {issues.length}
        </span>
      </header>

      <ul
        className={styles.cards}
        aria-label={`${STATUS_LABEL[status]} issues`}
      >
        {issues.length === 0 ? (
          <li className={styles.empty}>No issues</li>
        ) : (
          issues.map((issue) => (
            <li key={issue.id}>
              <Card issue={issue} labels={labels} onOpen={onOpen} onMove={onMove} />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function Card({
  issue,
  labels,
  onOpen,
  onMove,
}: {
  issue: Issue;
  labels: Label[];
  onOpen: (id: string) => void;
  onMove: (id: string, to: IssueStatus) => void;
}): React.JSX.Element {
  const optimistic = issue.version === 0;
  return (
    <article
      className={styles.card}
      data-optimistic={optimistic ? "true" : "false"}
      role="button"
      tabIndex={0}
      aria-label={`${issue.title}, ${STATUS_LABEL[issue.status]}`}
      onClick={() => onOpen(issue.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(issue.id);
        }
      }}
    >
      <h3 className={styles.cardTitle}>{issue.title}</h3>
      <div className={styles.cardMeta}>
        <LabelDots labelIds={issue.labelIds} labels={labels} />
        {optimistic ? <span className={styles.optimistic}>pending</span> : null}
        <select
          className={styles.moveSelect}
          value={issue.status}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => onMove(issue.id, e.target.value as IssueStatus)}
          aria-label={`Move ${issue.title} to another column`}
        >
          {COLUMN_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}
