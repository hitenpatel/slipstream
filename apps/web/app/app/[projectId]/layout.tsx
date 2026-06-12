"use client";

import { use, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { KeepAlive } from "../keep-alive";
import { IssueDetailDialog } from "./issue-detail-dialog";
import { ProjectToolbar } from "./project-toolbar";
import { ProjectView } from "./project-view";
import { BoardView } from "./board/board-view";
import styles from "./layout.module.css";

/**
 * Project layout owns both views (list + board) and toggles which is in
 * flow via KeepAlive. The page.tsx files for /[projectId] and
 * /[projectId]/board are now just route markers that render `null`; this
 * layout decides what to show based on the URL. Result: switching between
 * List and Board preserves scroll, focus, in-flight DnD state, and the
 * dialog without remounting.
 *
 * The `{children}` slot is still passed through so a future detail-route
 * could land here without breaking the contract.
 */
export default function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}): React.JSX.Element {
  const { projectId } = use(params);
  const pathname = usePathname();
  const isBoard = pathname.endsWith("/board");

  return (
    <>
      <ProjectToolbar projectId={projectId} />
      <div className={styles.viewport}>
        <KeepAlive active={!isBoard} label="List view">
          <ProjectView projectId={projectId} />
        </KeepAlive>
        <KeepAlive active={isBoard} label="Board view">
          <BoardView projectId={projectId} />
        </KeepAlive>
      </div>
      {/* Route children are kept off-screen but mounted, in case a future
          /app/[projectId]/[issueId] segment wants to participate. */}
      <div hidden>{children}</div>
      <IssueDetailDialog projectId={projectId} />
    </>
  );
}
