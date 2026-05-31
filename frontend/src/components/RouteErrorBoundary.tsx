import { useRouteError, useNavigate, isRouteErrorResponse } from 'react-router-dom';

// RouteErrorBoundary -- the net under the trapeze. React Router routes it here
// whenever a loader, action, or render throws, so a single broken page no longer
// blanks the whole app into a white void of despair.
export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  let title = 'Something went sideways';
  let detail = 'An unexpected error knocked this view off its feet.';

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    detail = typeof error.data === 'string' ? error.data : detail;
  } else if (error instanceof Error) {
    detail = error.message;
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-5 min-h-[60vh] px-6 text-center"
      role="alert"
    >
      <div
        className="flex items-center justify-center w-14 h-14 rounded-2xl text-2xl"
        style={{ background: 'var(--bg-surface)', color: 'var(--accent)' }}
      >
        !
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h1>
        <p className="text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>
          {detail}
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
        >
          Go back
        </button>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'var(--accent)', color: 'var(--accent-contrast, #fff)' }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}
