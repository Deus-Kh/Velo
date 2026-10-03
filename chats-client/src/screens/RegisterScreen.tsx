import { View, Text, Pressable, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../components/Button';
import Input from '../components/Input';
import { Icon } from '../components/Icon';
import { useThemeColors } from '../theme/useThemeColors';
import { useAuthStore } from '../store/auth.store';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../app/Navigation';
import { useForm, Controller } from 'react-hook-form';
import { useCallback, useMemo, useState } from 'react';
import { toApiError, type ApiErrorShape } from '../shared/api/errors';
import { newPasswordRules, PASSWORD_MIN_LENGTH } from '../shared/validation/password';
import { passwordVerdict } from '../shared/validation/passwordVerdict';

type NavProp = NativeStackNavigationProp<RootStackParamList, 'Register'>;

interface FormData {
  email: string;
  username: string;
  password: string;
  passwordRepeat: string;
}

/**
 * Registration (roadmap §8.1 A5): a live verdict under the password from
 * the first character (length, blanks, the user's own name or email, the
 * client's strength estimate), a "repeat password" field checked before
 * submit, and an unmistakable failure state when the account cannot be
 * created: the server's refusal lands on the field it names (a weak or
 * breached password, a taken email or username), and a network failure
 * shows a banner with a retry.
 */
export default function RegisterScreen() {
  const navigation = useNavigation<NavProp>();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const registerUser = useAuthStore((s) => s.register);

  const [failure, setFailure] = useState<ApiErrorShape | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    watch,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    mode: 'onTouched',
    defaultValues: { email: '', username: '', password: '', passwordRepeat: '' },
  });

  const emailValue = watch('email');
  const usernameValue = watch('username');
  const passwordValue = watch('password');
  const repeatValue = watch('passwordRepeat');
  const verdict = useMemo(() => passwordVerdict(passwordValue, { email: emailValue, username: usernameValue }), [passwordValue, emailValue, usernameValue]);
  const repeatMismatch = repeatValue.length > 0 && repeatValue !== passwordValue;

  const onSubmit = useCallback(
    async (data: FormData) => {
      setFailure(null);
      try {
        await registerUser({ email: data.email.trim(), username: data.username.trim(), password: data.password });
      } catch (e) {
        const err = toApiError(e);
        // The server names the field it refused: a weak or breached password, a taken email or username.
        for (const [field, message] of Object.entries(err.fields)) {
          if (field === 'email' || field === 'username' || field === 'password') setError(field, { message });
        }
        if (err.code === 'EMAIL_TAKEN') setError('email', { message: 'This email already has an account' });
        if (err.code === 'USERNAME_TAKEN') setError('username', { message: 'This username is taken' });
        setFailure(err);
      }
    },
    [registerUser, setError],
  );

  const retry = useCallback(() => handleSubmit(onSubmit)(), [handleSubmit, onSubmit]);

  const strengthTone = verdict.strength.score <= 1 ? 'bg-danger' : verdict.strength.score === 2 ? 'bg-warning' : 'bg-success';
  const verdictLine = errors.password?.message ?? (verdict.status === 'empty' ? null : verdict.reason);
  const verdictOk = !errors.password && verdict.status === 'ok';

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 20) }}
        className="flex-1 px-5"
      >
        <View className="pt-6">
          <Text className="text-xs font-semibold uppercase tracking-[2px] text-primary">Secure Messenger</Text>
          <Text className="mt-3 text-[34px] font-semibold text-text">Create account</Text>
          <Text className="mt-2 text-sm leading-6 text-muted">Start private conversations with end-to-end encryption built in.</Text>
        </View>

        <View className="mt-8 rounded-[28px] border border-border bg-surface/92 p-5">
          <View className="gap-3">
            <Controller
              control={control}
              name="email"
              rules={{ required: 'Email is required', pattern: { value: /^\S+@\S+\.\S+$/, message: 'That does not look like an email address' } }}
              render={({ field: { onChange, onBlur, value } }) => (
                <Input placeholder="Email" keyboardType="email-address" autoCapitalize="none" autoComplete="email" value={value} onChangeText={onChange} onBlur={onBlur} />
              )}
            />
            {errors.email ? <Text className="px-1 text-sm text-danger">{errors.email.message}</Text> : null}

            <Controller
              control={control}
              name="username"
              rules={{ required: 'Username is required', minLength: { value: 3, message: 'At least 3 characters' } }}
              render={({ field: { onChange, onBlur, value } }) => <Input placeholder="Username" autoCapitalize="none" autoComplete="username-new" value={value} onChangeText={onChange} onBlur={onBlur} />}
            />
            {errors.username ? <Text className="px-1 text-sm text-danger">{errors.username.message}</Text> : null}

            <Controller
              control={control}
              name="password"
              rules={{
                ...newPasswordRules,
                validate: (value) => {
                  const base = newPasswordRules.validate(value);
                  if (base !== true) return base;
                  const v = passwordVerdict(value, { email: getValues('email'), username: getValues('username') });
                  return v.status === 'ok' ? true : v.status === 'fail' ? v.reason : 'Password is required';
                },
              }}
              render={({ field: { onChange, onBlur, value } }) => (
                <Input placeholder={`Password (at least ${PASSWORD_MIN_LENGTH} characters)`} secureTextEntry autoComplete="new-password" value={value} onChangeText={onChange} onBlur={onBlur} />
              )}
            />

            {verdict.status !== 'empty' ? (
              <View className="px-1" accessibilityLiveRegion="polite">
                <View className="flex-row gap-1">
                  {[1, 2, 3, 4].map((step) => (
                    <View key={step} className={`h-1.5 flex-1 rounded-full ${step <= verdict.strength.score ? strengthTone : 'bg-border'}`} />
                  ))}
                </View>
                {verdictLine ? (
                  <View className="mt-1.5 flex-row items-center">
                    <Icon lib="Lucide" name={verdictOk ? 'check' : 'circle-alert'} size={14} color={verdictOk ? colors.success : colors.danger} />
                    <Text className={`ml-1.5 shrink text-xs ${verdictOk ? 'text-success' : 'text-danger'}`}>{verdictLine}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <Controller
              control={control}
              name="passwordRepeat"
              rules={{ required: 'Repeat the password', validate: (value) => value === getValues('password') || 'Passwords do not match' }}
              render={({ field: { onChange, onBlur, value } }) => <Input placeholder="Repeat password" secureTextEntry autoComplete="new-password" value={value} onChangeText={onChange} onBlur={onBlur} />}
            />
            {errors.passwordRepeat ? (
              <Text className="px-1 text-sm text-danger">{errors.passwordRepeat.message}</Text>
            ) : repeatMismatch ? (
              <Text className="px-1 text-sm text-danger">Passwords do not match</Text>
            ) : repeatValue.length > 0 ? (
              <View className="flex-row items-center px-1">
                <Icon lib="Lucide" name="check" size={14} color={colors.success} />
                <Text className="ml-1.5 text-xs text-success">Passwords match</Text>
              </View>
            ) : null}

            {failure ? (
              <View accessibilityRole="alert" className="rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3">
                <View className="flex-row items-start">
                  <View className="mr-2 mt-0.5">
                    <Icon lib="Lucide" name={failure.isNetwork ? 'wifi-off' : 'circle-alert'} size={16} color={colors.danger} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-semibold text-danger">{failure.isNetwork ? 'No connection' : 'Account not created'}</Text>
                    <Text className="mt-0.5 text-sm leading-5 text-danger">
                      {failure.isNetwork ? 'Could not reach the server. Check your connection and try again.' : Object.keys(failure.fields).length > 0 || failure.code === 'EMAIL_TAKEN' || failure.code === 'USERNAME_TAKEN' ? 'Fix the field marked above and try again.' : failure.message}
                    </Text>
                  </View>
                </View>
                {failure.isNetwork ? (
                  <Pressable onPress={retry} disabled={isSubmitting} accessibilityRole="button" className="mt-3 self-start rounded-full bg-danger/15 px-4 py-2 active:opacity-80">
                    <Text className="text-sm font-semibold text-danger">Try again</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View className="pt-2">
              <Button title={isSubmitting ? 'Creating account…' : 'Create account'} onPress={handleSubmit(onSubmit)} disabled={isSubmitting} />
            </View>
          </View>
        </View>

        <View className="mt-5 flex-row items-center justify-center">
          <Text className="text-sm text-muted">Already have an account? </Text>
          <Pressable onPress={() => navigation.navigate('Login')} className="active:opacity-80">
            <Text className="text-sm font-semibold text-primary">Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
