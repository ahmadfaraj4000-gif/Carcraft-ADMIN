import { getAuthUserId } from '@convex-dev/auth/server'

export async function getAdminUserId(ctx: any) {
  const userId = await getAuthUserId(ctx)
  const configuredEmail = process.env.ADMIN_USERNAME?.trim().toLowerCase()

  if (!userId || !configuredEmail) return null

  // Convex Auth password sessions identify the authenticated user by ID, but
  // do not consistently include the email on ctx.auth.getUserIdentity(). Read
  // the trusted users table instead, then enforce the configured admin email.
  const user = await ctx.db.get(userId)
  const userEmail = String(user?.email || '').trim().toLowerCase()
  if (userEmail !== configuredEmail) return null

  return userId
}

export async function requireAdmin(ctx: any) {
  const userId = await getAdminUserId(ctx)
  if (!userId) throw new Error('Admin authentication required')
  return userId
}
