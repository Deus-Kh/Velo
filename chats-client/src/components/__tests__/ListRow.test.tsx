import ReactTestRenderer from 'react-test-renderer';
import { Text, View } from 'react-native';
import ListRow, { UnreadBadge } from '../ListRow';

/**
 * Roadmap §8.1 B1 — the unified list row: title, time, one subtitle line,
 * a trailing slot; press and long-press forwarded; exceptional states are
 * a toned subtitle, not a chip.
 */
const renderedStrings = (tree: ReactTestRenderer.ReactTestRenderer): string[] =>
  tree.root.findAllByType(Text).map((t) => t.props.children).filter((c): c is string | number => typeof c === 'string' || typeof c === 'number').map(String);

jest.setTimeout(30_000);

describe('ListRow', () => {
  it('renders the title, the time, the subtitle and the trailing slot, and forwards presses', async () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <ListRow
          avatar={<View testID="avatar" />}
          title="Erin"
          meta="12:30"
          subtitle="You: see you tomorrow"
          trailing={<UnreadBadge count={3} />}
          onPress={onPress}
          onLongPress={onLongPress}
          testID="row"
        />,
      );
    });
    expect(renderedStrings(tree)).toEqual(['Erin', '12:30', 'You: see you tomorrow', '3']);
    expect(tree.root.findAllByProps({ testID: 'avatar' }).length).toBeGreaterThan(0);

    const row = tree.root.findAllByProps({ testID: 'row' })[0]!;
    await ReactTestRenderer.act(() => {
      row.props.onPress();
      row.props.onLongPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('shows an exceptional state as a toned subtitle with its icon', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<ListRow title="Dana" subtitle="No encryption key yet" subtitleTone="warning" subtitleIcon="key-round" onPress={() => undefined} />);
    });
    const subtitle = tree.root.findAllByType(Text).find((t) => t.props.children === 'No encryption key yet')!;
    expect(subtitle.props.className).toContain('text-warning');
  });

  it('caps the unread badge at 99+', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<UnreadBadge count={250} />);
    });
    expect(renderedStrings(tree)).toEqual(['99+']);
  });
});
