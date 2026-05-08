/**
 * ProxiedWebViewPanel — stub shell (sandboxed iframe owned by Agent 16).
 *
 * Props: `src`, `sandboxFlags`, `title`, `loading`.
 *
 * CSP note (Agent 16): parent page uses `frame-src 'none'` in `public/_headers` until proxy origin +
 * hashes are finalized; iframe embedding must widen `frame-src` to the dedicated sandbox origin only.
 */
export default function ProxiedWebViewPanel({ src = '', sandboxFlags = '', title = 'Proxied sandbox', loading = false }) {
  return (
    <div className="ds-stub" data-component="ProxiedWebViewPanel">
      <span className="ds-stub__title">ProxiedWebViewPanel</span>
      <div className="ds-stub__body">
        {loading ? <span className="ds-skeleton" aria-hidden="true" /> : null}
        <div data-src={src} data-sandbox={sandboxFlags}>
          Untrusted sandbox viewport — CSP `frame-src` open item for Agent 16.
        </div>
        <span className="visually-hidden">{title}</span>
      </div>
    </div>
  );
}
