// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import EstimateLeads from '../src/components/EstimateLeads'
const mocks = vi.hoisted(() => ({ queries: [], callbacks: [], mutate: vi.fn(async () => {}), archive: [] }))
vi.mock('convex/react', () => ({
  useMutation: () => mocks.mutate,
  useQuery: (reference, args) => {
    const name = getFunctionName(reference)
    if (args === 'skip') return undefined
    mocks.queries.push({ name, args })
    if (name.endsWith('listSummaries')) return mocks.archive
    const photos = [{ storageId: 'image-' + args.id, thumbnailUrl: '/small.webp', url: '/original.jpg' }]
    if (name.endsWith('getPhotos')) return photos
    return { _id: args.id, name: 'Archived customer', status: 'archived', archived: true, photos }
  }
}))
const leads = Array.from({ length: 10 }, (_, index) => ({ _id: 'lead-' + index, name: 'Customer ' + index, status: 'new', photoCount: 1 }))
beforeEach(() => {
  mocks.queries = []; mocks.callbacks = []; mocks.mutate.mockClear()
  mocks.archive = [{ _id: 'archived-1', name: 'Archived customer', status: 'archived', photoCount: 1 }]
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { mocks.callbacks.push(callback) }
    observe() {}
    disconnect() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
test('only first four leads request photos initially; scrolling loads later previews and full image opens on click', () => {
  render(<EstimateLeads leads={leads} />)
  const ids = new Set(mocks.queries.filter((query) => query.name.endsWith('getPhotos')).map((query) => query.args.id))
  expect([...ids]).toEqual(['lead-0', 'lead-1', 'lead-2', 'lead-3'])
  expect(screen.getAllByRole('img')).toHaveLength(4)
  expect(screen.getAllByRole('img').every((img) => img.getAttribute('src') === '/small.webp')).toBe(true)
  act(() => mocks.callbacks[0]([{ isIntersecting: true }]))
  expect(screen.getAllByRole('img')).toHaveLength(5)
  fireEvent.click(screen.getByRole('button', { name: 'Open damage photo 1 of 1 for Customer 0' }))
  expect(screen.getByRole('dialog').querySelector('img').getAttribute('src')).toBe('/original.jpg')
})
test('archive queries only after click and archive photos only after Open', () => {
  render(<EstimateLeads leads={leads} />)
  expect(mocks.queries.some((query) => query.name.endsWith('listSummaries'))).toBe(false)
  mocks.queries = []
  fireEvent.click(screen.getByRole('tab', { name: 'Archive' }))
  expect(mocks.queries.some((query) => query.name.endsWith('listSummaries'))).toBe(true)
  expect(mocks.queries.some((query) => query.name.endsWith('getPhotos') || query.name.endsWith('getDetails'))).toBe(false)
  expect(screen.queryAllByRole('img')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
  expect(mocks.queries.some((query) => query.name.endsWith('getDetails'))).toBe(true)
  expect(screen.getAllByRole('img')).toHaveLength(1)
})
test('each active estimate has a working archive action', async () => {
  render(<EstimateLeads leads={leads} />)
  expect(screen.getAllByRole('button', { name: 'Archive' })).toHaveLength(10)
  await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0]))
  expect(mocks.mutate).toHaveBeenCalledWith({ id: 'lead-0' })
})
