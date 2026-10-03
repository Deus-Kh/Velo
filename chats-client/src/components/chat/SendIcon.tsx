import Svg, { Path } from 'react-native-svg';

/** The paper-plane glyph of the 1:1 chat's send button. */
export default function SendIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21.8 3.6L3.9 10.9C3.1 11.2 3.1 12.4 3.9 12.7L11.1 15.5L13.9 22.1C14.2 22.9 15.4 22.9 15.7 22.1L23 4.2C23.3 3.4 22.6 2.7 21.8 3.6Z"
        fill={color}
      />
      <Path
        d="M11 15.5L22.3 4.2"
        stroke="#04131E"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.18}
      />
    </Svg>
  );
}
