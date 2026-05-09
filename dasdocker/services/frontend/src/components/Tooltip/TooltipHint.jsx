const srOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export default function TooltipHint({ id, text }) {
  return (
    <span id={id} role="tooltip" style={srOnly}>
      {text}
    </span>
  );
}
