import { useAuthStore } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

// Phase 8.3 will replace this with the real teams dashboard.
// For now it serves as the post-login landing page.
export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
        <span className="font-semibold text-gray-900 tracking-tight">V.42</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.full_name ?? user?.email}</span>
          <button
            onClick={() => void handleLogout()}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Выйти
          </button>
        </div>
      </header>

      <main className="p-8 max-w-2xl">
        <h1 className="text-xl font-semibold text-gray-900">
          Привет, {user?.full_name ?? '...'}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Phase 8.3 на подходе -- команды и люди.
        </p>
      </main>
    </div>
  );
}
