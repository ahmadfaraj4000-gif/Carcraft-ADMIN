// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import LeadQuote from '../src/components/LeadQuote'
const { saveQuote } = vi.hoisted(() => ({ saveQuote: vi.fn() }))
vi.mock('convex/react', () => ({ useMutation: () => saveQuote }))
const lead = { _id: 'lead-1', name: 'Test customer' }
beforeEach(() => saveQuote.mockReset().mockResolvedValue({}))
afterEach(cleanup)
const amount = () => screen.getByLabelText('Amount quoted ($)')
const upper = () => screen.getByLabelText('Upper amount ($, optional)')
const submit = () => act(async () => fireEvent.submit(screen.getByRole('form')))

test('saves an exact amount and a range as cents with success feedback', async () => {
  render(<LeadQuote lead={lead} />)
  fireEvent.change(amount(), { target: { value: '1500.50' } })
  await submit()
  expect(saveQuote).toHaveBeenLastCalledWith({ id: 'lead-1', minAmountCents: 150050 })
  expect(screen.getByRole('status').textContent).toBe('Quote saved.')
  fireEvent.change(upper(), { target: { value: '2000' } })
  expect(screen.queryByRole('status')).toBeNull()
  await submit()
  expect(saveQuote).toHaveBeenLastCalledWith({ id: 'lead-1', minAmountCents: 150050, maxAmountCents: 200000 })
})

test('loads an existing range and allows replacing it with an exact amount', async () => {
  const { rerender } = render(<LeadQuote lead={{ ...lead, quote: { minAmountCents: 125025, maxAmountCents: 160000 } }} />)
  expect(amount().value).toBe('1250.25')
  expect(upper().value).toBe('1600.00')
  expect(screen.getByText(/\$1,250.25 – \$1,600.00/)).toBeTruthy()
  fireEvent.change(upper(), { target: { value: '' } })
  await submit()
  expect(saveQuote).toHaveBeenCalledWith({ id: 'lead-1', minAmountCents: 125025 })
  rerender(<LeadQuote lead={{ ...lead, quote: { minAmountCents: 140000 } }} />)
  expect(amount().value).toBe('1400.00')
  expect(upper().value).toBe('')
})

test('rejects malformed amounts and reversed ranges before saving', async () => {
  render(<LeadQuote lead={lead} />)
  for (const value of ['', '-1', '1.234', 'NaN', '1e3', '1500 dollars']) {
    fireEvent.change(amount(), { target: { value } })
    await submit()
    expect(screen.getByRole('alert')).toBeTruthy()
  }
  fireEvent.change(amount(), { target: { value: '1500' } })
  fireEvent.change(upper(), { target: { value: '1000' } })
  await submit()
  expect(screen.getByRole('alert').textContent).toContain('upper amount')
  expect(saveQuote).not.toHaveBeenCalled()
})

test('disables inputs during saving and preserves the draft on failure for retry', async () => {
  let reject
  saveQuote.mockImplementationOnce(() => new Promise((resolve, rejectPromise) => { reject = rejectPromise }))
  render(<LeadQuote lead={lead} />)
  fireEvent.change(amount(), { target: { value: '999.99' } })
  await submit()
  expect(amount().disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Saving…' }).disabled).toBe(true)
  await act(async () => reject(new Error('Connection lost')))
  expect(screen.getByRole('alert').textContent).toContain('Connection lost')
  expect(amount().value).toBe('999.99')
  expect(amount().disabled).toBe(false)
  await submit()
  expect(screen.getByRole('status').textContent).toBe('Quote saved.')
})
