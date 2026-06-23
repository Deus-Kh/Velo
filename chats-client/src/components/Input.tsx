import { TextInput, TextInputProps } from 'react-native';

interface Props extends TextInputProps {
  placeholder: string;
}

export default function Input(props: Props) {
  return (
    <TextInput
      {...props}
      placeholderTextColor="#94A3B8"
      className="w-full rounded-[18px] border border-border bg-surface/92 px-4 py-3.5 text-[15px] text-text"
    />
  );
}
