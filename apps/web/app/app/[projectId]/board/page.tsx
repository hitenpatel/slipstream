"use client";

import { use } from "react";
import { BoardView } from "./board-view";

export default function BoardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): React.JSX.Element {
  const { projectId } = use(params);
  return <BoardView projectId={projectId} />;
}
