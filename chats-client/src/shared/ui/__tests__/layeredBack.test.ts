import { resolveBackPress, type BackLayer } from '../layeredBack';

/**
 * Roadmap §8.1 A7 — Back closes the topmost open layer and leaves the
 * screen only when nothing is open.
 */
const layer = (open: boolean) => {
  const close = jest.fn();
  return { layer: { open, close } as BackLayer, close };
};

describe('resolveBackPress', () => {
  it('with nothing open, Back leaves the screen', () => {
    const closeScreen = jest.fn();
    const a = layer(false);
    const b = layer(false);
    expect(resolveBackPress([a.layer, b.layer], closeScreen)).toEqual({ consumedBy: 'screen' });
    expect(closeScreen).toHaveBeenCalledTimes(1);
    expect(a.close).not.toHaveBeenCalled();
    expect(b.close).not.toHaveBeenCalled();
  });

  it('closes only the topmost open layer and keeps the screen', () => {
    const closeScreen = jest.fn();
    const replyBar = layer(true);
    const actionsSheet = layer(true);
    const forwardPicker = layer(false);
    expect(resolveBackPress([replyBar.layer, actionsSheet.layer, forwardPicker.layer], closeScreen)).toEqual({ consumedBy: 'layer' });
    expect(actionsSheet.close).toHaveBeenCalledTimes(1);
    expect(replyBar.close).not.toHaveBeenCalled();
    expect(forwardPicker.close).not.toHaveBeenCalled();
    expect(closeScreen).not.toHaveBeenCalled();
  });

  it('one press per layer: sheet, then bar, then the screen', () => {
    const closeScreen = jest.fn();
    const state = { bar: true, sheet: true };
    const layers: BackLayer[] = [
      { get open() { return state.bar; }, close: () => { state.bar = false; } },
      { get open() { return state.sheet; }, close: () => { state.sheet = false; } },
    ];
    expect(resolveBackPress(layers, closeScreen).consumedBy).toBe('layer');
    expect(state).toEqual({ bar: true, sheet: false });
    expect(resolveBackPress(layers, closeScreen).consumedBy).toBe('layer');
    expect(state).toEqual({ bar: false, sheet: false });
    expect(resolveBackPress(layers, closeScreen).consumedBy).toBe('screen');
    expect(closeScreen).toHaveBeenCalledTimes(1);
  });
});
