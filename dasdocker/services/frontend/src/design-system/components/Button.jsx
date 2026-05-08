/**
 * Button — stub shell (logic in Agent 15).
 *
 * Props: `variant` ('primary' | 'secondary' | 'ghost' | 'destructive'), `size` ('sm' | 'md' | 'lg'),
 * `disabled`, `loading`, `type`, `children`, optional `ariaLabel`.
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  type = 'button',
  children = null,
  ariaLabel,
  ...rest
}) {
  return (
    <div className="ds-stub" data-component="Button">
      <span className="ds-stub__title">Button</span>
      <div className="ds-stub__body">
        {loading ? <span className="ds-skeleton" aria-hidden="true" /> : null}
        <button
          type={type}
          disabled={disabled || loading}
          aria-busy={loading || undefined}
          aria-label={ariaLabel}
          data-variant={variant}
          data-size={size}
          {...rest}
        >
          {children}
        </button>
      </div>
    </div>
  );
}
