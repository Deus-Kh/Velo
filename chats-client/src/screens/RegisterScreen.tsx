import { View, Text, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../components/Button';
import Input from '../components/Input';
import { useAuthStore } from '../store/auth.store';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/Navigation';
import { useForm, Controller } from 'react-hook-form';
import { useMemo, useState } from 'react';
import { toApiError } from '../shared/api/errors';
import { estimatePasswordStrength, newPasswordRules, PASSWORD_MIN_LENGTH } from '../shared/validation/password';

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

  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    defaultValues: {
      email: '',
      username: '',
      password: '',
    },
  });

  const passwordValue = watch("password");
  const passwordStrength = useMemo(() => estimatePasswordStrength(passwordValue), [passwordValue]);

  const onSubmit = async (data: FormData) => {
    setSubmitError(null);
    try {
      await registerUser({
        email: data.email.trim(),
        username: data.username.trim(),
        password: data.password,
      });
    } catch (e) {
      const err = toApiError(e);
      for (const [field, message] of Object.entries(err.fields)) {
        if (field === 'email' || field === 'username' || field === 'password') {
          setError(field, { message });
        }
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
              rules={newPasswordRules}
              render={({ field: { onChange, value } }) => (
                <Input
                  placeholder={`Password (min ${PASSWORD_MIN_LENGTH} characters)`}
                  secureTextEntry
                  value={value}
                  onChangeText={onChange}
                />
              )}
            />
            {errors.password ? <Text className="px-1 text-sm text-danger">{errors.password.message}</Text> : null}
            {passwordStrength.score > 0 ? (
              <View
                className="px-1"
                accessibilityLabel={`Password strength: ${passwordStrength.label}`}
              >
                <View className="flex-row gap-1">
                  {[1, 2, 3, 4].map((step) => (
                    <View
                      key={step}
                      className={`h-1.5 flex-1 rounded-full ${
                        step <= passwordStrength.score
                          ? passwordStrength.score <= 1
                            ? 'bg-danger'
                            : passwordStrength.score === 2
                            ? 'bg-warning'
                            : 'bg-success'
                          : 'bg-border'
                      }`}
                    />
                  ))}
                </View>
                <Text className="mt-1 text-xs text-muted">
                  {passwordStrength.label}
                  {passwordStrength.score <= 2 ? ' · try a longer passphrase' : ''}
                </Text>
              </View>
            ) : null}

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
