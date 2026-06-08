import { convexAuth } from '@convex-dev/auth/server'
import { Password } from '@convex-dev/auth/providers/Password'

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        if (params.flow === 'signUp' && process.env.DISABLE_ADMIN_SIGNUPS === 'true') {
          throw new Error('Admin signup is disabled. Ask the owner to create staff access.')
        }

        const email = String(params.email || '').trim().toLowerCase()
        if (!email) throw new Error('Email is required')

        return { email }
      }
    })
  ]
})
