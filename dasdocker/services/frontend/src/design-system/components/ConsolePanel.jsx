/**
 * ConsolePanel — stub shell (logic in Agent 15 / 17 per integration).
 *
 * Props: `lines`, `onInput`, `disabled`, `loading`.
 */
export default function ConsolePanel({ lines = [], disabled = false, loading = false }) {
  return (
    <div className="ds-stub" data-component="ConsolePanel" style={{ font: 'var(--font-console)' }}>
      <span className="ds-stub__title">ConsolePanel</span>
      <div className="ds-stub__body">
        {loading ? <span className="ds-skeleton" aria-hidden="true" /> : null}
        <pre aria-disabled={disabled} data-line-count={lines.length}>
          {lines.length === 0 ? '$ ' : null}
        </pre>
      </div>
    </div>
  );
}
