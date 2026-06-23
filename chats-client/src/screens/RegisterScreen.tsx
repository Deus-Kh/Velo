import { View, Text, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../components/Button';
import Input from '../components/Input';
import { useAuthStore } from '../store/auth.store';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/Navigation';
import { useForm, Controller } from 'react-hook-form';

type NavProp = NativeStackNavigationProp<RootStackParamList, 'Register'>;

interface FormData {
  email: string;
  username: string;
  password: string;
}

export default function RegisterScreen() {
  const navigation = useNavigation<NavProp>();
  const insets = useSafeAreaInsets();
  const registerUser = useAuthStore((s) => s.register);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    defaultValues: {
      email: '',
      username: '',
      password: '',
    },
  });

  const onSubmit = async (data: FormData) => {
    await registerUser(data);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
    >
      <View className="flex-1 px-5" style={{ paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 20) }}>
        <View className="pt-6">
          <Text className="text-xs font-semibold uppercase tracking-[2px] text-primary">
            Secure Messenger
          </Text>
          <Text className="mt-3 text-[34px] font-semibold text-text">Create account</Text>
          <Text className="mt-2 text-sm leading-6 text-muted">
            Start private conversations with end-to-end encryption built in.
          </Text>
        </View>

        <View className="mt-8 rounded-[28px] border border-border bg-surface/92 p-5">
          <View className="gap-3">
            <Controller
              control={control}
              name="email"
              rules={{
                required: 'Email is required',
                pattern: {
                  value: /^\S+@\S+\.\S+$/,
                  message: 'Invalid email format',
                },
              }}
              render={({ field: { onChange, value } }) => (
                <Input
                  placeholder="Email"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={value}
                  onChangeText={onChange}
                />
              )}
            />
            {errors.email ? <Text className="px-1 text-sm text-danger">{errors.email.message}</Text> : null}

            <Controller
              control={control}
              name="username"
              rules={{
                required: 'Username is required',
                minLength: {
                  value: 3,
                  message: 'Minimum 3 characters',
                },
              }}
              render={({ field: { onChange, value } }) => (
                <Input
                  placeholder="Username"
                  autoCapitalize="none"
                  value={value}
                  onChangeText={onChange}
                />
              )}
            />
            {errors.username ? <Text className="px-1 text-sm text-danger">{errors.username.message}</Text> : null}

            <Controller
              control={control}
              name="password"
              rules={{
                required: 'Password is required',
                minLength: {
                  value: 6,
                  message: 'Minimum 6 characters',
                },
              }}
              render={({ field: { onChange, value } }) => (
                <Input
                  placeholder="Password"
                  secureTextEntry
                  value={value}
                  onChangeText={onChange}
                />
              )}
            />
            {errors.password ? <Text className="px-1 text-sm text-danger">{errors.password.message}</Text> : null}

            <View className="pt-2">
              <Button
                title={isSubmitting ? 'Creating account...' : 'Create account'}
                onPress={handleSubmit(onSubmit)}
                disabled={isSubmitting}
              />
            </View>
          </View>
        </View>

        <View className="mt-5 flex-row items-center justify-center">
          <Text className="text-sm text-muted">Already have an account? </Text>
          <Pressable onPress={() => navigation.navigate('Login')} className="active:opacity-80">
            <Text className="text-sm font-semibold text-primary">Sign in</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
