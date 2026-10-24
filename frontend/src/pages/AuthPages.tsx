import { Alert, Box, Button, Field, Heading, Input, Link, Stack, Text } from '@chakra-ui/react';
import { useState, type FormEvent } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { toaster } from '../components/toaster';

function AuthCard({ title, subtitle, children }: { title: string; subtitle: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box maxW="md" mx="auto" mt={{ base: '4', md: '12' }} layerStyle="card" p={{ base: '6', md: '10' }}>
      <Stack gap="2" mb="8" textAlign="center">
        <Heading size="2xl" letterSpacing="tight">{title}</Heading>
        <Text color="fg.muted">{subtitle}</Text>
      </Stack>
      {children}
    </Box>
  );
}

function useRedirectAfterAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  return () => navigate(from, { replace: true });
}

/** Maps API validation details to per-field messages. */
function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return {};
  return Object.fromEntries((err.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
}

export function LoginPage() {
  const { login } = useAuth();
  const redirect = useRedirectAfterAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const user = await login(email, password);
      toaster.success({ title: `Welcome back, ${user.name.split(' ')[0]}!` });
      redirect();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthCard title="Sign in" subtitle={<>New to Evently? <Link asChild colorPalette="brand" fontWeight="semibold"><RouterLink to="/register">Create an account</RouterLink></Link></>}>
      <form onSubmit={submit}>
        <Stack gap="5">
          {error && (
            <Alert.Root status="error" size="sm"><Alert.Indicator /><Alert.Title>{error}</Alert.Title></Alert.Root>
          )}
          <Field.Root required>
            <Field.Label>Email</Field.Label>
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field.Root>
          <Field.Root required>
            <Field.Label>Password</Field.Label>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field.Root>
          <Button type="submit" colorPalette="brand" size="lg" loading={pending}>Sign in</Button>
        </Stack>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const redirect = useRedirectAfterAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    setErrors({});
    try {
      await register(form.name, form.email, form.password);
      toaster.success({ title: 'Account created', description: 'Welcome to Evently!' });
      redirect();
    } catch (err) {
      const byField = fieldErrors(err);
      setErrors(byField);
      if (Object.keys(byField).length === 0) setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthCard title="Create your account" subtitle={<>Already have one? <Link asChild colorPalette="brand" fontWeight="semibold"><RouterLink to="/login">Sign in</RouterLink></Link></>}>
      <form onSubmit={submit}>
        <Stack gap="5">
          {error && (
            <Alert.Root status="error" size="sm"><Alert.Indicator /><Alert.Title>{error}</Alert.Title></Alert.Root>
          )}
          <Field.Root required invalid={Boolean(errors.name)}>
            <Field.Label>Full name</Field.Label>
            <Input autoComplete="name" value={form.name} onChange={set('name')} />
            <Field.ErrorText>{errors.name}</Field.ErrorText>
          </Field.Root>
          <Field.Root required invalid={Boolean(errors.email)}>
            <Field.Label>Email</Field.Label>
            <Input type="email" autoComplete="email" value={form.email} onChange={set('email')} />
            <Field.ErrorText>{errors.email}</Field.ErrorText>
          </Field.Root>
          <Field.Root required invalid={Boolean(errors.password)}>
            <Field.Label>Password</Field.Label>
            <Input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
            {errors.password ? <Field.ErrorText>{errors.password}</Field.ErrorText> : <Field.HelperText>At least 8 characters.</Field.HelperText>}
          </Field.Root>
          <Button type="submit" colorPalette="brand" size="lg" loading={pending}>Create account</Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
