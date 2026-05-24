/**
 * Reusable table pagination bar.
 * Shows: "1-25 of 143" and prev/next page buttons.
 */
interface PaginatorProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

export function Paginator({ page, pageSize, total, onChange }: PaginatorProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  return (
    <div
      className="flex items-center justify-between px-1 py-2 text-xs select-none"
      style={{ color: 'var(--text-3)' }}
    >
      <span data-testid="paginator-info">
        {total === 0 ? '0 items' : `${from}–${to} of ${total}`}
      </span>
      <div className="flex items-center gap-1">
        <PageBtn label="«" title="First page"    disabled={page <= 1}          onClick={() => onChange(1)}          />
        <PageBtn label="‹" title="Previous page" disabled={page <= 1}          onClick={() => onChange(page - 1)}   />
        <span className="px-2 font-medium" style={{ color: 'var(--text-2)' }}>
          {page} / {totalPages}
        </span>
        <PageBtn label="›" title="Next page"     disabled={page >= totalPages} onClick={() => onChange(page + 1)}   />
        <PageBtn label="»" title="Last page"     disabled={page >= totalPages} onClick={() => onChange(totalPages)} />
      </div>
    </div>
  );
}

function PageBtn({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="w-7 h-7 rounded flex items-center justify-center font-medium transition-colors
        enabled:hover:bg-[var(--bg-elevated)] disabled:opacity-30 disabled:cursor-not-allowed"
      style={{ color: 'var(--text-2)' }}
    >
      {label}
    </button>
  );
}
