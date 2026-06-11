"use client";

import { useMemo, useState } from "react";
import {
  between,
  IssueStatus,
  uuidv7,
  type Issue,
  type IssueStatus as IssueStatusT,
} from "@slipstream/protocol";
import { useEngine, useEngineState } from "../engine-provider";
import styles from "./project-view.module.css";

const STATUSES: IssueStatusT[] = ["backlog", "todo", "in_progress", "done", "cancelled"];

const STATUS_LABEL: Record<IssueStatusT, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export function ProjectView({ projectId }: { projectId: string }): React.JSX.Element {
  const { engine, me } = useEngine();
  const view = useEngineState((s) => s.view);

  const project = view.get("project", projectId);
  const issues = useMemo(() => {
    const out: Issue[] = [];
    for (const e of view.entities.values()) {
      if (e.kind === "issue" && e.projectId === projectId && !e.deleted) {
        out.push(e);
      }
    }
    out.sort((a, b) => a.position.localeCompare(b.position));
    return out;
  }, [view, projectId]);

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
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            <span className={styles.projectKey}>{project.key}</span>
            <span>{issues.length} {issues.length === 1 ? "issue" : "issues"}</span>
          </p>
          <h1 className={styles.title}>{project.name}</h1>
        </div>
      </header>

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

      {issues.length === 0 ? (
        <p className={styles.empty}>No issues yet. The title field above is the fastest way in.</p>
      ) : (
        <ul className={styles.list} aria-label={`${project.name} issues`}>
          {issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              onStatus={(s) => setStatus(issue.id, s)}
              onDelete={() => deleteIssue(issue.id)}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function IssueRow({
  issue,
  onStatus,
  onDelete,
}: {
  issue: Issue;
  onStatus: (s: IssueStatusT) => void;
  onDelete: () => void;
}): React.JSX.Element {
  const optimistic = issue.version === 0;
  return (
    <li className={styles.row} data-optimistic={optimistic ? "true" : "false"}>
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
      <span className={styles.title2}>{issue.title}</span>
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
    </li>
  );
}
