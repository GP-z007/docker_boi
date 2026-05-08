/**
 * NetworkTimeline — stub shell (logic in Agent 16).
 *
 * Props: `events`, `onSelect`, `timezoneDisplay`, `loading`.
 */
export default function NetworkTimeline({ events = [], timezoneDisplay = 'local', loading = false }) {
  return (
    <div className="ds-stub" data-component="NetworkTimeline" role="list">
      <span className="ds-stub__title">NetworkTimeline</span>
      <div className="ds-stub__body">
        {loading ? <span className="ds-skeleton" aria-hidden="true" /> : null}
        <div data-timezone={timezoneDisplay} data-event-count={events.length} />
      </div>
    </div>
  );
}
