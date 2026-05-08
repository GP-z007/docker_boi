import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AlertFeed from '../design-system/components/AlertFeed.jsx';
import Button from '../design-system/components/Button.jsx';
import ConsolePanel from '../design-system/components/ConsolePanel.jsx';
import CountdownTimer from '../design-system/components/CountdownTimer.jsx';
import NetworkTimeline from '../design-system/components/NetworkTimeline.jsx';
import ProcessTree from '../design-system/components/ProcessTree.jsx';
import ProxiedWebViewPanel from '../design-system/components/ProxiedWebViewPanel.jsx';
import StatusBadge from '../design-system/components/StatusBadge.jsx';

describe('design system stubs (snapshots)', () => {
  it('Button', () => {
    const { container } = render(<Button loading>Start</Button>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('StatusBadge', () => {
    const { container } = render(<StatusBadge status="live" loading />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('CountdownTimer', () => {
    const { container } = render(<CountdownTimer endsAt="2099-01-01T00:00:00Z" loading />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('AlertFeed', () => {
    const { container } = render(<AlertFeed loading />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('ProcessTree', () => {
    const { container } = render(<ProcessTree loading />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('NetworkTimeline', () => {
    const { container } = render(<NetworkTimeline loading />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('ConsolePanel', () => {
    const { container } = render(<ConsolePanel loading />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it('ProxiedWebViewPanel', () => {
    const { container } = render(<ProxiedWebViewPanel loading />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
