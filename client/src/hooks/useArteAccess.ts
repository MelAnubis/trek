import { usePermissionsStore } from '../store/permissionsStore'
import { useAuthStore } from '../store/authStore'

/**
 * Whether the current user may open the illustrated-maps module (Arte).
 * Admin → Permissions → "arte_use": admins always, everyone else only when the
 * level is "everybody". Unlike useCanDo, an unloaded permission is a "no" so
 * the nav entry doesn't flash for users who can't open it.
 */
export function useArteAccess(): boolean {
  const level = usePermissionsStore(s => s.permissions.arte_use)
  const user = useAuthStore(s => s.user)
  if (!user) return false
  return user.role === 'admin' || level === 'everybody'
}
