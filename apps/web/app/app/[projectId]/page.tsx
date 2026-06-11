"use client";

import { use } from "react";
import { ProjectView } from "./project-view";

export default function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): React.JSX.Element {
  const { projectId } = use(params);
  return <ProjectView projectId={projectId} />;
}
