"use client";

import { useMemo } from "react";
import type { Comment, Issue, Label, Project } from "@slipstream/protocol";
import { useEngineState } from "../engine-provider";

/**
 * Read every entity in the synced store that belongs to the given project,
 * pre-sorted. The view is recomputed on every mutate/applyPatch, so these
 * arrays are deterministic and equality-stable within a single render pass.
 */
export function useProjectData(projectId: string): {
  project: Project | undefined;
  issues: Issue[];
  labels: Label[];
  commentsByIssue: Map<string, Comment[]>;
} {
  const view = useEngineState((s) => s.view);

  return useMemo(() => {
    let project: Project | undefined;
    const issues: Issue[] = [];
    const labels: Label[] = [];
    const commentsByIssue = new Map<string, Comment[]>();

    for (const e of view.entities.values()) {
      if (e.deleted) continue;
      switch (e.kind) {
        case "project":
          if (e.id === projectId) project = e;
          break;
        case "issue":
          if (e.projectId === projectId) issues.push(e);
          break;
        case "label":
          if (e.projectId === projectId) labels.push(e);
          break;
        case "comment": {
          const list = commentsByIssue.get(e.issueId) ?? [];
          list.push(e);
          commentsByIssue.set(e.issueId, list);
          break;
        }
        default:
          break;
      }
    }

    issues.sort((a, b) => a.position.localeCompare(b.position));
    labels.sort((a, b) => a.name.localeCompare(b.name));
    for (const list of commentsByIssue.values()) {
      list.sort((a, b) => a.createdAt - b.createdAt);
    }

    return { project, issues, labels, commentsByIssue };
  }, [view, projectId]);
}
