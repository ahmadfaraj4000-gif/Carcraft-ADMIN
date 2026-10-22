// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import AfterpayManager from '../src/components/AfterpayManager'
import PaymentPage from '../src/payments/PaymentPage'
const state = vi.hoisted(() => ({ settings: {}, requests: [], publicRequest: null, create: vi.fn(), complete: vi.fn(), clipboard: vi.fn() }))
vi.mock('convex/react', () => ({
  useQuery: (reference, args) => {
    if (args === 'skip') return undefined
    const name = getFunctionName(reference)
    if (name === 'payments:settings') return state.settings
    if (name === 'payments:list') return state.requests
    return state.publicRequest
  },
  useAction: reference => getFunctionName(reference) === 'afterpay:createLink' ? state.create : state.complete,
  useMutation: () => vi.fn()
}))
const token = 'a'.repeat(64)
beforeEach(() => {
  state.settings = { enabled: false, configured: false, environment: null }
  state.requests = []
  state.publicRequest = { invoiceNumber: 'CC-1', amountCents: 10025, status: 'pending', expiresAt: Date.now() + 86400000, environment: null, checkoutEnabled: false }
  state.create.mockReset().mockResolvedValue({ link: `https://carcraft.example/after-pay.html?payment=${token}` })
  state.complete.mockReset().mockResolvedValue({ status: 'review' })
  state.clipboard.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: state.clipboard } })
  window.history.replaceState({}, '', `/after-pay.html?payment=${token}`)
})
afterEach(cleanup)
test('admin generates and copies a link with the exact invoice amount, with no surcharge', async () => {
  render(<AfterpayManager />)
  expect(screen.getByText(/customer payments are not enabled/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Invoice number'), { target: { value: 'CC-100' } })
  fireEvent.change(screen.getByLabelText('Invoice amount ($)'), { target: { value: '100.25' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create payment link' })))
  expect(state.create).toHaveBeenCalledWith({ invoiceNumber: 'CC-100', amountCents: 10025, note: '', expiresInDays: 7 })
  expect(screen.getByLabelText('Payment link').value).toContain(token)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy payment link' })))
  expect(state.clipboard).toHaveBeenCalledWith(`https://carcraft.example/after-pay.html?payment=${token}`)
})
test('customer can review an invoice while checkout is disabled without submitting contact details', () => {
  render(<PaymentPage />)
  expect(screen.getByText('$100.25')).toBeTruthy()
  expect(screen.getByText('Online payment is not available yet.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Continue to Afterpay' })).toBeNull()
  expect(screen.queryByLabelText('Email address')).toBeNull()
})
test('forged SUCCESS redirect never displays payment received before backend confirmation', async () => {
  window.history.replaceState({}, '', `/after-pay.html?payment=${token}&return=1&status=SUCCESS&orderToken=provider-token`)
  state.publicRequest.status = 'checkout_started'
  state.publicRequest.checkoutEnabled = true
  await act(async () => render(<PaymentPage />))
  expect(state.complete).toHaveBeenCalledWith({ token, checkoutToken: 'provider-token' })
  expect(screen.queryByText('Payment received')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Continue to Afterpay' })).toBeNull()
})
test('paid sandbox invoice is clearly distinguished from money received', () => {
  state.publicRequest.status = 'paid'; state.publicRequest.environment = 'sandbox'
  render(<PaymentPage />)
  expect(screen.getByText('Test payment completed')).toBeTruthy()
  expect(screen.getByText('No funds were collected.')).toBeTruthy()
})
test('cancelled customer links cannot open another checkout', () => {
  state.publicRequest.status = 'cancelled'; state.publicRequest.checkoutEnabled = true
  render(<PaymentPage />)
  expect(screen.getByText(/payment link was cancelled/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Continue to Afterpay' })).toBeNull()
})
test.each(['CANCELLED', 'UNKNOWN', ''])('a return with status %s never attempts capture', async status => {
  window.history.replaceState({}, '', `/after-pay.html?payment=${token}&return=1&status=${status}&orderToken=provider-token`)
  state.publicRequest.status = 'checkout_started'; state.publicRequest.checkoutEnabled = true
  await act(async () => render(<PaymentPage />))
  expect(state.complete).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Retry payment verification' })).toBeNull()
})
