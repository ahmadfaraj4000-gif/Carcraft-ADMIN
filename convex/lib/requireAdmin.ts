import { getAuthUserId } from '@convex-dev/auth/server'

export async function getAdminUserId(ctx: any) {
  const [userId, identity] = await Promise.all([
    getAuthUserId(ctx),
    ctx.auth.getUserIdentity()
  ])
  const configuredEmail = process.env.ADMIN_USERNAME?.trim().toLowerCase()
  const identityEmail = String(identity?.email || '').trim().toLowerCase()

  if (!userId || !identity || !configuredEmail || identityEmail !== configuredEmail) return null
  return userId
}

export async function requireAdmin(ctx: any) {
  const userId = await getAdminUserId(ctx)
  if (!userId) throw new Error('Admin authentication required')
  return userId
}
