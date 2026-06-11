"use client";

import { use, type ReactNode } from "react";
import { ProjectToolbar } from "./project-toolbar";
import { IssueDetailDialog } from "./issue-detail-dialog";

export default function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}): React.JSX.Element {
  const { projectId } = use(params);
  return (
    <>
      <ProjectToolbar projectId={projectId} />
      {children}
      <IssueDetailDialog projectId={projectId} />
    </>
  );
}
