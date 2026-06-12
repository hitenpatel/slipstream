// The list view is mounted by the project layout via <KeepAlive>. This file
// exists only so Next registers the /app/[projectId] route; it renders
// nothing because the layout owns the view tree.
export default function ListRoute(): null {
  return null;
}
