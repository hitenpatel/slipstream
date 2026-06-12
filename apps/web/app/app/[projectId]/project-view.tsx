"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  IssueStatus,
  between,
  uuidv7,
  type Issue,
  type IssueStatus as IssueStatusT,
  type Label,
} from "@slipstream/protocol";
import { useEngine } from "../engine-provider";
import { STATUS_LABEL, applyFilters, useFilters } from "./filters";
import { useProjectData } from "./hooks";
import { LabelDots } from "./label-dots";
import { VirtualIssueList } from "./virtual-issue-list";
import styles from "./project-view.module.css";

const STATUSES: IssueStatusT[] = ["backlog", "todo", "in_progress", "done", "cancelled"];

export function ProjectView({ projectId }: { projectId: string }): React.JSX.Element {
  const { engine, me } = useEngine();
  const { project, issues, labels } = useProjectData(projectId);
  const filters = useFilters();
  const router = useRouter();
  const params = useSearchParams();

  const filtered = applyFilters(issues, filters);

  const [newTitle, setNewTitle] = useState("");

  async function createIssue(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || !project) return;
    const last = issues[issues.length - 1]?.position ?? null;
    const position = between(last, null);
    await engine.mutate("createIssue", {
      id: uuidv7(),
      workspaceId: me.workspaceId,
      projectId,
      title,
      position,
    });
    setNewTitle("");
    void engine.sync();
  }

  async function setStatus(issueId: string, status: IssueStatusT): Promise<void> {
    await engine.mutate("updateIssueStatus", { id: issueId, status });
    void engine.sync();
  }

  async function deleteIssue(issueId: string): Promise<void> {
    await engine.mutate("deleteIssue", { id: issueId });
    void engine.sync();
  }

  function openIssue(issueId: string): void {
    const next = new URLSearchParams(params.toString());
    next.set("issue", issueId);
    router.replace(`?${next.toString()}`);
  }

  if (!project) {
    return (
      <main className={styles.main}>
        <section className={styles.panel}>
          <h1 className={styles.title}>Project not found.</h1>
          <p>
            The project may not exist in your workspace yet, or it might still be syncing in. Pick
            another project from the sidebar, or refresh.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <form onSubmit={createIssue} className={styles.newRow}>
        <input
          className={styles.newInput}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New issue title (Enter to create)"
          aria-label="New issue title"
        />
        <button type="submit" className={styles.primary} disabled={!newTitle.trim()}>
          Create
        </button>
      </form>

      {filtered.length === 0 ? (
        <p className={styles.empty}>
          {issues.length === 0
            ? "No issues yet. The title field above is the fastest way in."
            : "No issues match the current filters."}
        </p>
      ) : (
        <VirtualIssueList
          issues={filtered}
          ariaLabel={`${project.name} issues`}
          renderRow={(issue) => (
            <IssueRow
              issue={issue}
              labels={labels}
              onStatus={(s) => setStatus(issue.id, s)}
              onDelete={() => deleteIssue(issue.id)}
              onOpen={() => openIssue(issue.id)}
            />
          )}
        />
      )}
    </main>
  );
}

function IssueRow({
  issue,
  labels,
  onStatus,
  onDelete,
  onOpen,
}: {
  issue: Issue;
  labels: Label[];
  onStatus: (s: IssueStatusT) => void;
  onDelete: () => void;
  onOpen: () => void;
}): React.JSX.Element {
  const optimistic = issue.version === 0;

  return (
    <div className={styles.row} data-optimistic={optimistic ? "true" : "false"}>
      <select
        className={styles.statusSelect}
        value={issue.status}
        aria-label={`Status of ${issue.title}`}
        onChange={(e) => {
          const next = IssueStatus.safeParse(e.target.value);
          if (next.success) onStatus(next.data);
        }}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <button type="button" className={styles.title2} onClick={onOpen}>
        {issue.title}
      </button>
      <LabelDots labelIds={issue.labelIds} labels={labels} />
      {optimistic ? (
        <span className={styles.optimistic} aria-label="Not yet confirmed by the server">
          pending
        </span>
      ) : null}
      <button
        type="button"
        className={styles.delete}
        onClick={onDelete}
        aria-label={`Delete ${issue.title}`}
      >
        ×
      </button>
    </div>
  );
}
