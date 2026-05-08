/**
 * ProcessTree — stub shell (logic in Agent 16).
 *
 * Props: `nodes` (tree list), `onNodeFocus`, `expandDepth`, `loading`.
 */
export default function ProcessTree({ nodes = [], expandDepth = 1, loading = false }) {
  return (
    <div className="ds-stub" data-component="ProcessTree" role="tree">
      <span className="ds-stub__title">ProcessTree</span>
      <div className="ds-stub__body">
        {loading ? <span className="ds-skeleton" aria-hidden="true" /> : null}
        <div data-expand-depth={expandDepth} data-node-count={nodes.length} />
      </div>
    </div>
  );
}
