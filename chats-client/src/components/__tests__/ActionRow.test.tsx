import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import ActionRow from '../ActionRow';

/**
 * Roadmap §8.1 A6 — the "New group" entry used to be a card with flex-1
 * inside a column, which rendered as an empty outline with no title and no
 * reachable press. The action row renders its title and subtitle from its
 * content and forwards the press.
 */
const renderedStrings = (tree: ReactTestRenderer.ReactTestRenderer): string[] =>
  Array.from(new Set(tree.root.findAllByType(Text).map((t) => t.props.children).filter((c): c is string => typeof c === 'string')));

describe('ActionRow', () => {
  it('renders its title and subtitle and forwards the press', async () => {
    const onPress = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <ActionRow icon="users" title="New group" subtitle="Encrypted end to end for every member" onPress={onPress} testID="new-group-row" />,
      );
    });
    expect(renderedStrings(tree)).toEqual(['New group', 'Encrypted end to end for every member']);

    const rows = tree.root.findAllByProps({ testID: 'new-group-row' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.props.accessibilityLabel === 'New group')).toBe(true);
    await ReactTestRenderer.act(() => {
      rows[0]!.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders without a subtitle', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<ActionRow icon="user-plus" title="Invite" onPress={() => undefined} />);
    });
    expect(renderedStrings(tree)).toEqual(['Invite']);
  });
});
