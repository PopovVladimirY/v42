// Cynefin-style clarity indicator. Instead of one flat square we draw a 2x2 map
// of the Cynefin domains and light up the quadrant the element lives in.
//
//   Complex (tacit)  | Complicated (scoped)
//   Chaos   (foggy)  | Simple      (clear)
//
// 'unknown' = Disorder (center): not yet sorted -> nothing is lit, text muted.
import type { ClarityQuadrant } from '@/types';
import { CLARITY_LABEL } from '@/types';

export const CLARITY_HEX: Record<ClarityQuadrant, string> = {
  clear:   '#10B981',
  scoped:  '#FBBF24',
  tacit:   '#F97316',
  foggy:   '#EF4444',
  unknown: '#9CA3AF',
};

// Row-major order of the 2x2 map (top-left, top-right, bottom-left, bottom-right)
// following the Cynefin layout: Complex / Complicated / Chaos / Simple.
const GRID: ClarityQuadrant[] = ['tacit', 'scoped', 'foggy', 'clear'];

const FOG = 'rgba(148, 163, 184, 0.2)';   // unlit cells -- faint but still mark the quadrant grid

// Cynefin domain explanations -- shown as picker tooltips so the meaning is
// spelled out instead of just echoing the field label.
const CLARITY_CYNEFIN: Record<ClarityQuadrant, string> = {
  clear:
    'Simple -- the ordered domain of known knowns. Cause and effect are obvious to anyone. Sense, categorise, respond: apply the best practice and ship.',
  scoped:
    'Complicated -- known unknowns. Cause and effect exist but need analysis or expertise to uncover. Sense, analyse, respond: bring in the experts, pick a good practice.',
  tacit:
    'Complex -- unknown unknowns. Cause and effect are only clear in hindsight. Probe, sense, respond: run safe-to-fail experiments and let practice emerge.',
  foggy:
    'Chaos -- no perceivable cause and effect. Turbulent and urgent. Act, sense, respond: do something to stabilise first, then find novel practice.',
  unknown:
    'Disorder -- the centre: we do not yet know which domain we are in. Break the item down until it lands in one of the four.',
};

// -- Read-only mini map (table rows, headers) --------------------------------
export function ClarityIndicator({ clarity, size = 16 }: { clarity: ClarityQuadrant; size?: number }) {
  // Active quadrant lit with its colour; everything else stays fogged.
  // Disorder ('unknown') matches nothing -> the whole map stays dark.
  const cellColor = (q: ClarityQuadrant) => (q === clarity ? CLARITY_HEX[q] : FOG);
  return (
    <span
      data-testid={`clarity-badge-${clarity}`}
      title={`Clarity: ${CLARITY_LABEL[clarity]}`}
      style={{
        display: 'inline-grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 1,
        width: size,
        height: size,
        padding: 1,
        borderRadius: 3,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    >
      {GRID.map((q) => {
        const lit = q === clarity;
        return (
          <span
            key={q}
            style={{
              background: cellColor(q),
              borderRadius: 1,
              // Lit cell pops with a tight glow; fogged cells stay flat and dim.
              boxShadow: lit ? `0 0 ${Math.max(2, size / 5)}px ${CLARITY_HEX[q]}` : 'none',
            }}
          />
        );
      })}
    </span>
  );
}

// -- Interactive quadrant picker (detail pages) ------------------------------
export function ClarityPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: ClarityQuadrant;
  onChange: (next: ClarityQuadrant) => void;
  disabled?: boolean;
}) {
  const quad = (q: ClarityQuadrant) => {
    const active = value === q;
    return (
      <button
        key={q}
        type="button"
        disabled={disabled}
        onClick={() => onChange(q)}
        data-testid={`clarity-pick-${q}`}
        title={CLARITY_CYNEFIN[q]}
        onMouseEnter={(e) => { if (!active && !disabled) { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.filter = 'saturate(0.9)'; } }}
        onMouseLeave={(e) => { if (!active && !disabled) { e.currentTarget.style.opacity = '0.45'; e.currentTarget.style.filter = 'saturate(0.6)'; } }}
        className="text-xs font-medium rounded transition-all"
        style={{
          padding: '8px 12px',
          minWidth: '7rem',
          textAlign: 'left',
          cursor: disabled ? 'default' : 'pointer',
          color: active ? '#fff' : 'var(--text-3)',
          background: active ? CLARITY_HEX[q] : 'var(--bg-surface)',
          border: `1px solid ${active ? CLARITY_HEX[q] : 'var(--border)'}`,
          boxShadow: active ? `0 0 0 2px ${CLARITY_HEX[q]}55, 0 2px 8px ${CLARITY_HEX[q]}40` : 'none',
          opacity: disabled ? 0.6 : active ? 1 : 0.45,
          filter: active ? 'none' : 'saturate(0.6)',
        }}
      >
        {CLARITY_LABEL[q]}
      </button>
    );
  };
  const disorderActive = value === 'unknown';
  return (
    <div className="inline-flex flex-col gap-1">
      <div className="grid grid-cols-2 gap-1">
        {GRID.map((q) => quad(q))}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('unknown')}
        data-testid="clarity-pick-unknown"
        title={CLARITY_CYNEFIN.unknown}
        className="text-xs font-medium rounded transition-all"
        style={{
          padding: '6px 8px',
          textAlign: 'center',
          cursor: disabled ? 'default' : 'pointer',
          color: disorderActive ? '#fff' : 'var(--text-3)',
          background: disorderActive ? CLARITY_HEX.unknown : 'var(--bg-surface)',
          border: `1px solid ${disorderActive ? CLARITY_HEX.unknown : 'var(--border)'}`,
          boxShadow: disorderActive ? `0 0 0 2px ${CLARITY_HEX.unknown}55, 0 2px 8px ${CLARITY_HEX.unknown}40` : 'none',
          opacity: disabled ? 0.6 : disorderActive ? 1 : 0.45,
          filter: disorderActive ? 'none' : 'saturate(0.6)',
        }}
      >
        {CLARITY_LABEL.unknown}
      </button>
    </div>
  );
}
