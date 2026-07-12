"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type * as Y from "yjs";
import {
  IssueStatus,
  Y_TEXT_FIELD,
  applyUpdateB64,
  decodeDocOrFromText,
  diffUpdateB64,
  readBody,
  snapshotStateVector,
  uuidv7,
  type Issue,
  type IssueStatus as IssueStatusT,
  type IssuePriority,
} from "@slipstream/protocol";
import { useEngine } from "../engine-provider";
import { PresenceAvatars } from "../presence-avatars";
import { PRIORITY_LABEL, STATUS_LABEL } from "./filters";
import { LabelChips } from "./label-chips";
import { TriagePanel } from "./triage-panel";
import { useProjectData } from "./hooks";
import styles from "./issue-detail-dialog.module.css";

const STATUSES: IssueStatusT[] = ["backlog", "todo", "in_progress", "done", "cancelled"];
const PRIORITIES: IssuePriority[] = [0, 1, 2, 3, 4];

export function IssueDetailDialog({ projectId }: { projectId: string }): React.JSX.Element | null {
  const params = useSearchParams();
  const router = useRouter();
  const issueId = params.get("issue");
  const { engine, me } = useEngine();
  const { project, issues, labels, commentsByIssue } = useProjectData(projectId);

  const dialogRef = useRef<HTMLDivElement>(null);
  const issue = issueId ? issues.find((i) => i.id === issueId) : undefined;

  // Esc closes; focus is moved into the dialog when it opens.
  useEffect(() => {
    if (!issueId) return;
    const dialog = dialogRef.current;
    dialog?.focus();
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);

  function close(): void {
    const next = new URLSearchParams(params.toString());
    next.delete("issue");
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname);
  }

  if (!issueId || !issue || !project) return null;

  return (
    <div className={styles.scrim}>
      {/* The scrim is a decorative backdrop; the close-on-click affordance
         lives on a same-position button below so AT users get a Close action
         without the scrim itself needing interactive semantics. */}
      <button
        type="button"
        className={styles.scrimButton}
        aria-label="Close dialog"
        onClick={close}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-detail-title"
        tabIndex={-1}
        className={styles.dialog}
      >
        <DetailBody
          issue={issue}
          issues={issues}
          labels={labels}
          comments={commentsByIssue.get(issue.id) ?? []}
          workspaceId={me.workspaceId}
          projectId={projectId}
          authorId={me.userId}
          onClose={close}
          onMutate={(name, args) =>
            engine.mutate(name as never, args).then(() => engine.sync())
          }
        />
      </div>
    </div>
  );
}

function DetailBody({
  issue,
  issues,
  labels,
  comments,
  workspaceId,
  projectId,
  authorId,
  onClose,
  onMutate,
}: {
  issue: Issue;
  issues: Issue[];
  labels: import("@slipstream/protocol").Label[];
  comments: import("@slipstream/protocol").Comment[];
  workspaceId: string;
  projectId: string;
  authorId: string;
  onClose: () => void;
  onMutate: (name: string, args: unknown) => Promise<void>;
}): React.JSX.Element {
  const [title, setTitle] = useState(issue.title);
  const [commentBody, setCommentBody] = useState("");
  const [newLabelName, setNewLabelName] = useState("");

  // Description is a per-field CRDT (M7c / ADR-001 future extension): the
  // issue stores a base64-encoded Y.Doc state. We keep one Y.Doc per
  // dialog open, decoded from the server's current state. Every time the
  // server's description advances (a remote tab edited it, or our own
  // local edit came back confirmed), we apply that state into the local
  // doc — Yjs dedupes by op id so this is idempotent.
  const descriptionDoc = useDescriptionDoc(issue.id, issue.description);
  const [description, setDescription] = useState(() => readBody(descriptionDoc));

  // Re-render the textarea whenever the doc's body changes (either from a
  // remote update or from our own input).
  useEffect(() => {
    setDescription(readBody(descriptionDoc));
    const onUpdate = () => setDescription(readBody(descriptionDoc));
    descriptionDoc.on("update", onUpdate);
    return () => descriptionDoc.off("update", onUpdate);
  }, [descriptionDoc]);

  // Re-sync local title state when the underlying issue changes from elsewhere.
  useEffect(() => setTitle(issue.title), [issue.title]);

  async function saveTitle(): Promise<void> {
    const next = title.trim();
    if (!next || next === issue.title) return;
    await onMutate("updateIssue", { id: issue.id, patch: { title: next } });
  }

  /**
   * Diff the textarea's new value against the Y.Text, apply a minimal
   * delete-then-insert at the common-prefix boundary, capture the Y.Doc
   * update since the snapshot, and send it through the engine. Yjs's
   * CRDT semantics ensure concurrent edits from another tab/user merge
   * deterministically.
   */
  async function onDescriptionInput(next: string): Promise<void> {
    const sv = snapshotStateVector(descriptionDoc);
    applyTextDiff(descriptionDoc.getText(Y_TEXT_FIELD), next);
    const updateB64 = diffUpdateB64(descriptionDoc, sv);
    if (!updateB64) return;
    setDescription(next);
    await onMutate("editIssueDescription", { id: issue.id, updateB64 });
  }
  async function setStatus(s: IssueStatusT): Promise<void> {
    await onMutate("updateIssueStatus", { id: issue.id, status: s });
  }
  async function setPriority(p: IssuePriority): Promise<void> {
    await onMutate("updateIssue", { id: issue.id, patch: { priority: p } });
  }
  async function toggleLabel(labelId: string): Promise<void> {
    const has = issue.labelIds.includes(labelId);
    const next = has ? issue.labelIds.filter((l) => l !== labelId) : [...issue.labelIds, labelId];
    await onMutate("updateIssue", { id: issue.id, patch: { labelIds: next } });
  }
  async function postComment(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const body = commentBody.trim();
    if (!body) return;
    await onMutate("addComment", {
      id: uuidv7(),
      workspaceId,
      issueId: issue.id,
      authorId,
      body,
    });
    setCommentBody("");
  }
  async function createLabel(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const name = newLabelName.trim();
    if (!name) return;
    const colour = pickColour(name);
    await onMutate("createLabel", {
      id: uuidv7(),
      workspaceId,
      projectId,
      name,
      colour,
    });
    setNewLabelName("");
  }
  async function deleteIssue(): Promise<void> {
    await onMutate("deleteIssue", { id: issue.id });
    onClose();
  }

  return (
    <div className={styles.body}>
      <header className={styles.header}>
        <input
          id="issue-detail-title"
          className={styles.titleInput}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Issue title"
        />
        <PresenceAvatars focus={{ kind: "issue", id: issue.id }} max={4} />
        <button type="button" onClick={onClose} className={styles.close} aria-label="Close">
          ×
        </button>
      </header>

      <div className={styles.controls}>
        <Field label="Status">
          <select
            value={issue.status}
            onChange={(e) => {
              const next = IssueStatus.safeParse(e.target.value);
              if (next.success) setStatus(next.data);
            }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <select
            value={issue.priority}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (PRIORITIES.includes(n as IssuePriority)) setPriority(n as IssuePriority);
            }}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assignee">
          <span className={styles.muted}>
            {issue.assigneeId ? "—" : "Unassigned"}
          </span>
        </Field>
      </div>

      <section className={styles.section} aria-labelledby="labels-h">
        <h3 id="labels-h" className={styles.sectionTitle}>
          Labels
        </h3>
        <LabelChips
          allLabels={labels}
          activeIds={issue.labelIds}
          onToggle={toggleLabel}
        />
        <form onSubmit={createLabel} className={styles.newLabelRow}>
          <input
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            placeholder="New label name"
            aria-label="New label name"
          />
          <button type="submit" disabled={!newLabelName.trim()}>
            Add
          </button>
        </form>
      </section>

      <TriagePanel issue={issue} labels={labels} issues={issues} onMutate={onMutate} />

      <section className={styles.section} aria-labelledby="desc-h">
        <h3 id="desc-h" className={styles.sectionTitle}>
          Description
        </h3>
        <textarea
          className={styles.description}
          value={description}
          // Per-character publishes are debounced inside onDescriptionInput
          // via the Y.Text diff (no diff → no op → no send). Concurrent
          // edits from another user merge through Yjs CRDT semantics.
          onChange={(e) => void onDescriptionInput(e.target.value)}
          placeholder="Add a description…"
          rows={6}
        />
      </section>

      <section className={styles.section} aria-labelledby="comments-h">
        <h3 id="comments-h" className={styles.sectionTitle}>
          Comments
        </h3>
        {comments.length === 0 ? (
          <p className={styles.muted}>No comments yet.</p>
        ) : (
          <ul className={styles.comments}>
            {comments.map((c) => (
              <li key={c.id} className={styles.comment}>
                <p className={styles.commentBody}>{c.body}</p>
                <p className={styles.commentMeta}>
                  <span className={styles.commentAuthor}>{c.authorId.slice(0, 8)}</span>
                  <time dateTime={new Date(c.createdAt).toISOString()}>
                    {new Date(c.createdAt).toLocaleString()}
                  </time>
                  {c.version === 0 ? <span className={styles.optimistic}>pending</span> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={postComment} className={styles.commentForm}>
          <label className={styles.srOnly} htmlFor="comment-body">
            Add a comment
          </label>
          <textarea
            id="comment-body"
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="Add a comment…"
            rows={2}
          />
          <button type="submit" disabled={!commentBody.trim()}>
            Comment
          </button>
        </form>
      </section>

      <footer className={styles.footer}>
        <button type="button" className={styles.dangerGhost} onClick={deleteIssue}>
          Delete issue
        </button>
        <span className={styles.muted}>
          v{issue.version === 0 ? "pending" : issue.version}
        </span>
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

const PALETTE = ["#6ea8ff", "#3fbf6c", "#bf6e6e", "#bfaa6e", "#aa6ebf", "#6ebfae"];
function pickColour(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/**
 * Per-issue Y.Doc cache hook. Builds (or reuses) a Y.Doc seeded from the
 * server's current description state. Every time the server's description
 * field advances, applyUpdateB64 brings the local doc up to date — Yjs
 * dedupes by op id, so applying our own already-applied edits is a no-op.
 */
function useDescriptionDoc(issueId: string, serverDescription: string): Y.Doc {
  const docs = useRef(new Map<string, Y.Doc>());
  const doc = useMemo(() => {
    const existing = docs.current.get(issueId);
    if (existing) return existing;
    const fresh = decodeDocOrFromText(serverDescription);
    docs.current.set(issueId, fresh);
    return fresh;
  }, [issueId, serverDescription]);

  // When the server's description changes (e.g. a remote user edited it),
  // merge that state into our local doc.
  useEffect(() => {
    if (!serverDescription) return;
    // Apply the new server state as if it were an update. Yjs accepts a
    // full state as input to applyUpdate.
    applyUpdateB64(doc, serverDescription);
  }, [doc, serverDescription]);

  return doc;
}

/**
 * Minimal text diff applied to a Y.Text: find the common prefix and suffix,
 * delete the changed middle, insert the new content. One delete + one
 * insert per keystroke, but each is a standalone Yjs op so concurrent
 * edits at non-overlapping ranges merge cleanly.
 */
function applyTextDiff(ytext: Y.Text, next: string): void {
  const current = ytext.toString();
  if (current === next) return;

  let prefix = 0;
  const minLen = Math.min(current.length, next.length);
  while (prefix < minLen && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    current.charCodeAt(current.length - 1 - suffix) ===
      next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }

  const deleteLen = current.length - prefix - suffix;
  const insertText = next.slice(prefix, next.length - suffix);

  if (deleteLen > 0) ytext.delete(prefix, deleteLen);
  if (insertText.length > 0) ytext.insert(prefix, insertText);
}
