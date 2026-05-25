import { useParams } from 'react-router-dom';

export function SprintTestsTab() {
  const { projectId, sprintId } = useParams<{ projectId: string; sprintId: string }>();
  void projectId;
  void sprintId;

  return (
    <div className="h-full flex items-center justify-center">
      <p className="text-sm" style={{ color: 'var(--text-3)' }}>
        Test results &mdash; coming soon.
      </p>
    </div>
  );
}
