import { View, Text, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../components/Button';
import Input from '../components/Input';
import { useAuthStore } from '../store/auth.store';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/Navigation';
import { useForm, Controller } from 'react-hook-form';
import { useState } from 'react';
import { toApiError } from '../shared/api/errors';
import { loginPasswordRules } from '../shared/validation/password';

type NavProp = NativeStackNavigationProp<RootStackParamList, 'Login'>;

interface FormData {
  email: string;
  password: string;
}

export default function LoginScreen() {
  const navigation = useNavigation<NavProp>();
  const insets = useSafeAreaInsets();
  const loginUser = useAuthStore((s) => s.login);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: FormData) => {
    setSubmitError(null);
    try {
      await loginUser({ email: data.email.trim(), password: data.password });
    } catch (e) {
      const err = toApiError(e);
      for (const [field, message] of Object.entries(err.fields)) {
        if (field === 'email' || field === 'password') setError(field, { message });
      }
      setSubmitError(err.message);
    }
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
          <Text className="mt-3 text-[34px] font-semibold text-text">Welcome back</Text>
          <Text className="mt-2 text-sm leading-6 text-muted">
            Sign in to continue your encrypted conversations.
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
              name="password"
              rules={loginPasswordRules}
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

            {submitError ? (
              <View
                accessibilityRole="alert"
                className="rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3"
              >
                <Text className="text-sm text-danger">{submitError}</Text>
              </View>
            ) : null}

            <View className="pt-2">
              <Button
                title={isSubmitting ? 'Signing in...' : 'Sign in'}
                onPress={handleSubmit(onSubmit)}
                disabled={isSubmitting}
              />
            </View>
          </View>
        </View>

        <View className="mt-5 flex-row items-center justify-center">
          <Text className="text-sm text-muted">No account yet? </Text>
          <Pressable onPress={() => navigation.navigate('Register')} className="active:opacity-80">
            <Text className="text-sm font-semibold text-primary">Create one</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
