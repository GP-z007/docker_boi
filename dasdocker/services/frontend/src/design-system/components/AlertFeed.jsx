/**
 * AlertFeed — stub shell (logic in Agent 17).
 *
 * Props: `alerts` (array), `maxVisible`, `onSelectAlert`, `dense`, `pollIntervalMs`, `loading`.
 */
export default function AlertFeed({ alerts = [], maxVisible = 5, dense = false, loading = false }) {
  return (
    <section className="ds-stub" data-component="AlertFeed" aria-label="IDS alerts">
      <span className="ds-stub__title">AlertFeed</span>
      <div className="ds-stub__body">
        {loading ? <span className="ds-skeleton" aria-hidden="true" /> : null}
        <ul data-dense={dense} data-max-visible={maxVisible}>
          {alerts.length === 0 ? <li>No IDS alerts</li> : null}
        </ul>
      </div>
    </section>
  );
}
