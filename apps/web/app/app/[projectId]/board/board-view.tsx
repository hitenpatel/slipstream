"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  between,
  type Issue,
  type IssueStatus,
  type IssuePriority,
} from "@slipstream/protocol";
import { useEngine } from "../../engine-provider";
import { STATUS_LABEL, applyFilters, useFilters } from "../filters";
import { useProjectData } from "../hooks";
import styles from "./board-view.module.css";

const COLUMN_ORDER: IssueStatus[] = ["backlog", "todo", "in_progress", "done", "cancelled"];

export function BoardView({ projectId }: { projectId: string }): React.JSX.Element {
  const { engine } = useEngine();
  const { project, issues } = useProjectData(projectId);
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
    return map;
  }, [filtered]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIssue = activeId ? issues.find((i) => i.id === activeId) ?? null : null;

  function openIssue(issueId: string): void {
    const next = new URLSearchParams(params.toString());
    next.set("issue", issueId);
    router.replace(`?${next.toString()}`);
  }

  // Mobile fallback for the drag gesture: the per-card status <select> calls
  // this to append the issue to the destination column. Cross-column drags are
  // fiddly on touch even with a dedicated handle, so a native select is the
  // most reliable escape hatch.
  async function moveTo(issueId: string, to: IssueStatus): Promise<void> {
    const dest = columns[to];
    if (dest[dest.length - 1]?.id === issueId) return;
    const last = dest[dest.length - 1]?.position ?? null;
    const position = between(last, null);
    await engine.mutate("moveIssue", { id: issueId, status: to, position });
    void engine.sync();
  }

  function findColumnOf(issueId: string): IssueStatus | undefined {
    for (const status of COLUMN_ORDER) {
      if (columns[status].some((i) => i.id === issueId)) return status;
    }
    return undefined;
  }

  function onDragStart(e: DragStartEvent): void {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent): Promise<void> {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const activeIssueId = String(active.id);
    const overId = String(over.id);

    const fromStatus = findColumnOf(activeIssueId);
    if (!fromStatus) return;

    // Drop target can be either another issue card or a column droppable.
    const toStatus = (COLUMN_ORDER.find((s) => s === overId) ?? findColumnOf(overId)) as
      | IssueStatus
      | undefined;
    if (!toStatus) return;

    const destColumn = columns[toStatus];
    const overIndex = destColumn.findIndex((i) => i.id === overId);
    const fromIndex = columns[fromStatus].findIndex((i) => i.id === activeIssueId);

    // Same-column reorder
    if (fromStatus === toStatus) {
      if (fromIndex === overIndex || overIndex === -1) return;
      const reordered = arrayMove(destColumn, fromIndex, overIndex);
      const newIdx = reordered.findIndex((i) => i.id === activeIssueId);
      const before = reordered[newIdx - 1]?.position ?? null;
      const after = reordered[newIdx + 1]?.position ?? null;
      const position = between(before, after);
      await engine.mutate("moveIssue", { id: activeIssueId, status: toStatus, position });
      void engine.sync();
      return;
    }

    // Cross-column drop: place at the position of the over-card, or at the
    // end of the destination column if dropping on the column itself.
    let position: string;
    if (overIndex === -1) {
      // dropped onto the column container
      const last = destColumn[destColumn.length - 1]?.position ?? null;
      position = between(last, null);
    } else {
      const before = destColumn[overIndex - 1]?.position ?? null;
      const after = destColumn[overIndex]?.position ?? null;
      position = between(before, after);
    }
    await engine.mutate("moveIssue", { id: activeIssueId, status: toStatus, position });
    void engine.sync();
  }

  // Live-region narration tuned for screen readers, per dnd-kit's recipe.
  const announcements: Announcements = {
    onDragStart({ active }) {
      const issue = issues.find((i) => i.id === active.id);
      const col = findColumnOf(String(active.id));
      if (!issue || !col) return undefined;
      const idx = columns[col].findIndex((i) => i.id === issue.id) + 1;
      return `Grabbed ${issue.title}. In ${STATUS_LABEL[col]}, position ${idx} of ${columns[col].length}. Use arrow keys to move, space to drop, escape to cancel.`;
    },
    onDragOver({ active, over }) {
      const issue = issues.find((i) => i.id === active.id);
      if (!issue) return undefined;
      if (!over) return `${issue.title} is no longer over a drop target.`;
      const overId = String(over.id);
      const toStatus = (COLUMN_ORDER.find((s) => s === overId) ?? findColumnOf(overId)) as
        | IssueStatus
        | undefined;
      if (!toStatus) return undefined;
      const destColumn = columns[toStatus];
      const overIndex = destColumn.findIndex((i) => i.id === overId);
      const pos = overIndex === -1 ? destColumn.length + 1 : overIndex + 1;
      return `${issue.title}: ${STATUS_LABEL[toStatus]}, position ${pos} of ${destColumn.length || 1}.`;
    },
    onDragEnd({ active, over }) {
      const issue = issues.find((i) => i.id === active.id);
      if (!issue) return undefined;
      if (!over) return `${issue.title} returned to its original position.`;
      const overId = String(over.id);
      const toStatus = (COLUMN_ORDER.find((s) => s === overId) ?? findColumnOf(overId)) as
        | IssueStatus
        | undefined;
      if (!toStatus) return undefined;
      return `Dropped ${issue.title} in ${STATUS_LABEL[toStatus]}.`;
    },
    onDragCancel({ active }) {
      const issue = issues.find((i) => i.id === active.id);
      return issue ? `Cancelled. ${issue.title} returned to its original position.` : undefined;
    },
  };

  if (!project) {
    return <main className={styles.empty}>Project not found.</main>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To pick up a card, press space or enter. While dragging, use arrow keys to move. Press space or enter to drop, escape to cancel.",
        },
      }}
    >
      <main className={styles.board}>
        {COLUMN_ORDER.map((status) => (
          <Column
            key={status}
            status={status}
            issues={columns[status]}
            projectKey={project?.key ?? ""}
            onOpen={openIssue}
            onMove={moveTo}
          />
        ))}
      </main>
      <DragOverlay>
        {activeIssue ? (
          <article className={styles.cardDrag} aria-hidden="true">
            <h3 className={styles.cardDragTitle}>{activeIssue.title}</h3>
          </article>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  issues,
  projectKey,
  onOpen,
  onMove,
}: {
  status: IssueStatus;
  issues: Issue[];
  projectKey: string;
  onOpen: (id: string) => void;
  onMove: (id: string, to: IssueStatus) => Promise<void>;
}): React.JSX.Element {
  // Registers the column itself as a drop target so cross-column drops
  // work even when the destination column is empty.
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={styles.column}
      data-status={status}
      data-over={isOver ? "true" : "false"}
      aria-labelledby={`col-h-${status}`}
    >
      <header className={styles.colHeader}>
        <span className={styles.statusShape} aria-hidden="true" />
        <h2 id={`col-h-${status}`} className={styles.colTitle}>
          {STATUS_LABEL[status]}
        </h2>
        <span className={styles.colCount} aria-label={`${issues.length} issues`}>
          {issues.length}
        </span>
      </header>

      <SortableContext
        id={status}
        items={issues.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className={styles.cards} aria-label={`${STATUS_LABEL[status]} issues`}>
          {issues.length === 0 ? (
            <li className={styles.empty}>Drop here</li>
          ) : (
            issues.map((issue) => (
              <SortableCard
                key={issue.id}
                issue={issue}
                projectKey={projectKey}
                onOpen={onOpen}
                onMove={onMove}
              />
            ))
          )}
        </ul>
      </SortableContext>
    </section>
  );
}

function SortableCard({
  issue,
  projectKey,
  onOpen,
  onMove,
}: {
  issue: Issue;
  projectKey: string;
  onOpen: (id: string) => void;
  onMove: (id: string, to: IssueStatus) => Promise<void>;
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } as React.CSSProperties;

  const optimistic = issue.version === 0;
  const ticketId = issue.id.slice(-4).toUpperCase();
  const priorityLevel = priorityLevelFor(issue.priority);

  // Whole card is draggable via the article listeners so desktop users can
  // grab from anywhere. On touch, `touch-action: manipulation` lets scroll
  // gestures win by default; a 28x28 dedicated handle is provided in the
  // meta row for reliable touch drag. The per-card status <select> stays as
  // the mobile-friendly fallback for cross-column moves.
  return (
    <li ref={setNodeRef} style={style}>
      {/* dnd-kit's {...attributes} spread role="button" + tabindex="0" onto
          the article, so it IS interactive — the jsx-a11y linter can't see
          that. Keyboard opening lives on the inner openButton; adding an
          onKeyDown here would collide with dnd-kit's Space/Enter drag. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <article
        className={styles.card}
        data-optimistic={optimistic ? "true" : "false"}
        data-dragging={isDragging ? "true" : "false"}
        data-status={issue.status}
        {...attributes}
        {...listeners}
        aria-roledescription="Draggable issue card"
        aria-label={`${issue.title}, ${STATUS_LABEL[issue.status]}. Press space to drag.`}
        onClick={(e) => {
          // Click-anywhere-to-open, except when the click landed on an
          // interactive descendant (the status <select>, the touch drag
          // handle, or a link). Drag activations preventDefault the
          // synthetic click, so a real drag never gets here.
          const el = e.target as HTMLElement;
          if (el.closest("button, select, input, textarea, a")) return;
          onOpen(issue.id);
        }}
      >
        <span className={styles.statusEdge} aria-hidden="true" />
        <span className={styles.grip} aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" focusable="false">
            <circle cx="9" cy="6" r="1.6" />
            <circle cx="15" cy="6" r="1.6" />
            <circle cx="9" cy="12" r="1.6" />
            <circle cx="15" cy="12" r="1.6" />
            <circle cx="9" cy="18" r="1.6" />
            <circle cx="15" cy="18" r="1.6" />
          </svg>
        </span>
        <button
          type="button"
          className={styles.openButton}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(issue.id);
          }}
          // Space/Enter on the focused button opens the card; without
          // stopping the keydown here dnd-kit's KeyboardSensor would pick it
          // up as a drag activation instead. Mouse events are left to bubble
          // so MouseSensor's distance activation can start a drag when the
          // user pointer-drags the title.
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={`Open ${issue.title}`}
        >
          <h3 className={styles.cardTitle}>{issue.title}</h3>
        </button>
        <div className={styles.cardMeta}>
          <span className={styles.ticketId}>
            {projectKey}-<strong>{ticketId}</strong>
          </span>
          {priorityLevel ? (
            <>
              <span className={styles.metaDot} aria-hidden="true" />
              <span className={styles.priority} data-level={priorityLevel} aria-label={`Priority ${PRIORITY_SHORT[issue.priority]}`}>
                {PRIORITY_SHORT[issue.priority]}
              </span>
            </>
          ) : null}
          {optimistic ? (
            <>
              <span className={styles.metaDot} aria-hidden="true" />
              <span aria-label="Not yet confirmed by the server">pending</span>
            </>
          ) : null}
          <span className={styles.metaSpacer} />
          <span
            className={styles.avatar}
            data-unassigned={issue.assigneeId ? "false" : "true"}
            aria-hidden="true"
          />
          {/* Touch users get a 28×28 hit target in the meta row. The article-
              level listeners still fire when they long-press elsewhere on
              the card. */}
          <button
            type="button"
            className={styles.dragHandleTouch}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={`Drag ${issue.title}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" focusable="false" aria-hidden="true">
              <circle cx="9" cy="6" r="1.7" />
              <circle cx="15" cy="6" r="1.7" />
              <circle cx="9" cy="12" r="1.7" />
              <circle cx="15" cy="12" r="1.7" />
              <circle cx="9" cy="18" r="1.7" />
              <circle cx="15" cy="18" r="1.7" />
            </svg>
          </button>
          <label className={styles.statusLabel}>
            <span className={styles.srOnly}>Move {issue.title} to</span>
            <select
              className={styles.statusSelect}
              value={issue.status}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                void onMove(issue.id, e.target.value as IssueStatus);
              }}
            >
              {COLUMN_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </article>
    </li>
  );
}

const PRIORITY_SHORT: Record<IssuePriority, string> = {
  0: "—",
  1: "P4",
  2: "P3",
  3: "P2",
  4: "P1",
};

function priorityLevelFor(p: IssuePriority): "high" | "urgent" | "normal" | null {
  if (p === 4) return "urgent";
  if (p === 3) return "high";
  if (p === 0) return null;
  return "normal";
}
