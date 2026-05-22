import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { authApi } from '@/api/endpoints/auth';
import { useAuthStore } from '@/hooks/useAuth';
import { BubbleCanvas } from '@/components/BubbleCanvas';

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormData = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [serverError, setServerError] = useState<string | null>(null);
  const [bubblesActive, setBubblesActive] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  // After login, return to the page the user tried to visit
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? '/';

  async function onSubmit(data: FormData) {
    setServerError(null);
    try {
      const result = await authApi.login(data);
      setAuth(result.access_token, result.user);
      navigate(from, { replace: true });
    } catch {
      setServerError('Invalid email or password');
    }
  }

  return (
    <>
      {/* Easter egg: WebGL bubbles. Activated by clicking the bottom-left corner. */}
      <BubbleCanvas active={bubblesActive} />

      {/* Easter egg: click anywhere on the dark background to unleash the deep. */}
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ cursor: 'default' }}
        onClick={() => setBubblesActive((v) => !v)}
      >
        <div
          className="w-full max-w-sm rounded-xl p-8"
          style={{
            position: 'relative',
            zIndex: 20,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-md)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
        <h1
          className="text-2xl font-semibold mb-1 tracking-tight"
          style={{ color: 'var(--text-1)' }}
        >
          V.42
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
          Sign in to your workspace
        </p>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--text-1)' }}
              htmlFor="email"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              {...register('email')}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
            />
            {errors.email && (
              <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                {errors.email.message}
              </p>
            )}
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--text-1)' }}
              htmlFor="password"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
            />
            {errors.password && (
              <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>
                {errors.password.message}
              </p>
            )}
          </div>

          {serverError && (
            <p
              className="text-sm px-3 py-2 rounded-lg"
              style={{
                color: 'var(--color-danger)',
                background: 'rgba(239 68 68 / 0.1)',
                border: '1px solid rgba(239 68 68 / 0.2)',
              }}
            >
              {serverError}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2 px-4 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            onMouseEnter={(e) =>
              !isSubmitting && (e.currentTarget.style.background = 'var(--accent-hover)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = 'var(--accent)')
            }
          >
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
    </>
  );
}

