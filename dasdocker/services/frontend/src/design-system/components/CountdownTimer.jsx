/**
 * CountdownTimer — stub shell (logic in Agent 15).
 *
 * Props: `endsAt` (ISO string or epoch ms), `showSeconds`, `ariaCriticalThresholdSec`, `onExpire` (unused in stub).
 */
export default function CountdownTimer({
  endsAt,
  showSeconds = true,
  ariaCriticalThresholdSec,
  loading = false,
}) {
  return (
    <div className="ds-stub" data-component="CountdownTimer">
      <span className="ds-stub__title">CountdownTimer</span>
      <div className="ds-stub__body">
        {loading ? <span className="ds-skeleton" aria-hidden="true" /> : null}
        <span
          role="timer"
          data-ends-at={endsAt ?? ''}
          data-show-seconds={showSeconds}
          data-critical-threshold-sec={ariaCriticalThresholdSec ?? ''}
        >
          --:--
        </span>
      </div>
    </div>
  );
}
