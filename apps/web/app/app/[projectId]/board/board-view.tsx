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
  type Label,
} from "@slipstream/protocol";
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
            labels={labels}
            onOpen={openIssue}
          />
        ))}
      </main>
      <DragOverlay>
        {activeIssue ? (
          <article className={styles.cardDrag} aria-hidden="true">
            <h3 className={styles.cardTitle}>{activeIssue.title}</h3>
          </article>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  issues,
  labels,
  onOpen,
}: {
  status: IssueStatus;
  issues: Issue[];
  labels: Label[];
  onOpen: (id: string) => void;
}): React.JSX.Element {
  return (
    <section
      className={styles.column}
      aria-labelledby={`col-h-${status}`}
      data-droppable-id={status}
    >
      <header className={styles.colHeader}>
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
            <li className={styles.empty}>No issues</li>
          ) : (
            issues.map((issue) => (
              <SortableCard
                key={issue.id}
                issue={issue}
                labels={labels}
                onOpen={onOpen}
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
  labels,
  onOpen,
}: {
  issue: Issue;
  labels: Label[];
  onOpen: (id: string) => void;
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  } as React.CSSProperties;

  const optimistic = issue.version === 0;

  // The card body is the drag handle — pressing Space/Enter on the focused
  // card starts a drag; clicking opens the detail. We disambiguate by using
  // a separate "Open" button inside the card for navigation, leaving the
  // card surface itself as the draggable target.
  return (
    <li ref={setNodeRef} style={style}>
      <article
        className={styles.card}
        data-optimistic={optimistic ? "true" : "false"}
        data-dragging={isDragging ? "true" : "false"}
        {...attributes}
        {...listeners}
        aria-roledescription="Draggable issue card"
        aria-label={`${issue.title}, ${STATUS_LABEL[issue.status]}. Press space to drag.`}
      >
        <button
          type="button"
          className={styles.openButton}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(issue.id);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={`Open ${issue.title}`}
        >
          <h3 className={styles.cardTitle}>{issue.title}</h3>
        </button>
        <div className={styles.cardMeta}>
          <LabelDots labelIds={issue.labelIds} labels={labels} />
          {optimistic ? <span className={styles.optimistic}>pending</span> : null}
        </div>
      </article>
    </li>
  );
}
