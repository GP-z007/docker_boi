/**
 * StatusBadge — stub shell (logic in Agent 15).
 *
 * Props: `status` ('live' | 'provisioning' | 'draining' | 'expired' | 'failed'),
 * `alertLevel` ('none' | 'info' | 'warn' | 'critical'), `compact`, optional `label`.
 */
export default function StatusBadge({
  status = 'provisioning',
  alertLevel = 'none',
  compact = false,
  label,
  loading = false,
}) {
  return (
    <div className="ds-stub" data-component="StatusBadge">
      <span className="ds-stub__title">StatusBadge</span>
      <div className="ds-stub__body">
        {loading ? <span className="ds-skeleton" aria-hidden="true" /> : null}
        <span role="status" data-status={status} data-alert-level={alertLevel} data-compact={compact}>
          {label ?? status}
        </span>
      </div>
    </div>
  );
}
