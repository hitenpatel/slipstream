"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { Issue, IssueStatus, IssuePriority } from "@slipstream/protocol";

/**
 * URL-driven filters so a teammate can paste a link and get the same view.
 *
 *   ?status=todo,in_progress    multi-select status
 *   ?label=<id>,<id>            issues that carry ALL of these labels
 *   ?assignee=<userId>|none     "none" matches unassigned
 *   ?q=text                     case-insensitive substring of title
 */
export interface Filters {
  statuses: IssueStatus[];
  labelIds: string[];
  assignee: string | null; // null = no filter, "none" = unassigned
  q: string;
}

const STATUS_VALUES: IssueStatus[] = ["backlog", "todo", "in_progress", "done", "cancelled"];

export function useFilters(): Filters {
  const params = useSearchParams();
  const raw = {
    status: params.get("status") ?? "",
    label: params.get("label") ?? "",
    assignee: params.get("assignee"),
    q: params.get("q") ?? "",
  };
  return useMemo(() => {
    const statuses = raw.status
      .split(",")
      .filter(Boolean)
      .filter((s): s is IssueStatus => STATUS_VALUES.includes(s as IssueStatus));
    const labelIds = raw.label.split(",").filter(Boolean);
    const assignee = raw.assignee && raw.assignee.length > 0 ? raw.assignee : null;
    return { statuses, labelIds, assignee, q: raw.q.trim() };
    // raw.* are plain strings derived from params; recompute when any change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw.status, raw.label, raw.assignee, raw.q]);
}

export function applyFilters(issues: Issue[], filters: Filters): Issue[] {
  const { statuses, labelIds, assignee, q } = filters;
  const qLower = q.toLowerCase();

  return issues.filter((issue) => {
    if (statuses.length > 0 && !statuses.includes(issue.status)) return false;
    if (labelIds.length > 0 && !labelIds.every((id) => issue.labelIds.includes(id))) return false;
    if (assignee === "none" && issue.assigneeId !== null) return false;
    if (assignee && assignee !== "none" && issue.assigneeId !== assignee) return false;
    if (qLower && !issue.title.toLowerCase().includes(qLower)) return false;
    return true;
  });
}

/** stable label for a status used in select / chip UI */
export const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export const PRIORITY_LABEL: Record<IssuePriority, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};
