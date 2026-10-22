import { convexAuth } from '@convex-dev/auth/server'
import { Password } from '@convex-dev/auth/providers/Password'

const PBKDF2_ITERATIONS = 310_000
const HASH_BYTES = 32

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required authentication configuration: ${name}`)
  return value
}

function decodeBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }

  return difference === 0
}

async function derivePasswordHash(password: string) {
  const pepper = requiredEnv('ADMIN_PASSWORD_PEPPER')
  const salt = decodeBase64(requiredEnv('ADMIN_PASSWORD_SALT'))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${password}\u0000${pepper}`),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    HASH_BYTES * 8
  )
  return new Uint8Array(bits)
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = String(params.email || '').trim().toLowerCase()
        if (!email) throw new Error('Email is required')
        if (email !== requiredEnv('ADMIN_USERNAME').trim().toLowerCase()) {
          throw new Error('Invalid credentials')
        }
        if (params.flow === 'signUp') {
          throw new Error('Admin signup is disabled.')
        }

        return { email }
      },
      crypto: {
        async hashSecret() {
          // Account records never receive the plaintext password. Authentication
          // is verified against the server-only PBKDF2 hash below.
          return requiredEnv('ADMIN_PASSWORD_HASH')
        },
        async verifySecret(password) {
          const expected = decodeBase64(requiredEnv('ADMIN_PASSWORD_HASH'))
          if (expected.length !== HASH_BYTES) {
            throw new Error('Invalid authentication configuration')
          }
          const actual = await derivePasswordHash(password)
          return constantTimeEqual(actual, expected)
        }
      }
    })
  ]
})
