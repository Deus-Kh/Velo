import { getStatusColor, statusIconName } from '../MessageBubble';

describe('message delivery status presentation', () => {
  const colors = {
    bubbleOutMuted: 'muted',
    primary: 'primary',
    danger: 'danger',
  };

  it('uses distinct icons for queued, sent, delivered, read and failed states', () => {
    expect(statusIconName('sending')).toBe('clock');
    expect(statusIconName('sent')).toBe('check');
    expect(statusIconName('delivered')).toBe('check-check');
    expect(statusIconName('read')).toBe('check-check');
    expect(statusIconName('failed')).toBe('circle-alert');
  });

  it('uses the accent only for read receipts and danger for failures', () => {
    expect(getStatusColor('sending', colors)).toBe('muted');
    expect(getStatusColor('sent', colors)).toBe('muted');
    expect(getStatusColor('delivered', colors)).toBe('muted');
    expect(getStatusColor('read', colors)).toBe('primary');
    expect(getStatusColor('failed', colors)).toBe('danger');
  });
});
