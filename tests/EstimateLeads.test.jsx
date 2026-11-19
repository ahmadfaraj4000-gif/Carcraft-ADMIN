// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import EstimateLeads from '../src/components/EstimateLeads'
const mocks = vi.hoisted(() => ({ queries: [], callbacks: [], mutate: vi.fn(async () => {}), archive: [] }))
vi.mock('convex/react', () => ({
  useMutation: () => mocks.mutate,
  usePaginatedQuery: (ref, args) => {
    mocks.queries.push({name:getFunctionName(ref),args})
    return {results:args.archived ? mocks.archive : leads, status:'Exhausted',loadMore:vi.fn()}
  },
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
const leads = Array.from({ length: 14 }, (_, index) => ({ _id: 'lead-' + index, name: 'Customer ' + index, status: 'new', photoCount: 1 }))
beforeEach(() => {
  mocks.queries = []; mocks.callbacks = []; mocks.mutate.mockClear()
  mocks.archive = [{ _id: 'archived-1', name: 'Archived customer', status: 'archived', photoCount: 1 }]

})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
test('paginates summaries without fetching details or photos until Open estimate', () => {
  render(<EstimateLeads />)
  expect(screen.getAllByRole('button',{name:'Open estimate'})).toHaveLength(12)
  fireEvent.click(screen.getByRole('button',{name:'Next'}))
  expect(screen.getAllByRole('button',{name:'Open estimate'})).toHaveLength(2)
  expect(screen.getByRole('button',{name:'Next'}).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button',{name:'Previous'}))
  expect(mocks.queries.every(q=>q.name.endsWith('summaryPage'))).toBe(true)
  expect(screen.queryAllByRole('img')).toHaveLength(0)
})
test('archive queries only after click and archive photos only after Open', () => {
  render(<EstimateLeads />)
  expect(mocks.queries.some((query) => query.name.endsWith('summaryPage') && query.args.archived)).toBe(false)
  mocks.queries = []
  fireEvent.click(screen.getByRole('tab', { name: 'Archive' }))
  expect(mocks.queries.some((query) => query.name.endsWith('summaryPage') && query.args.archived)).toBe(true)
  expect(mocks.queries.some((query) => query.name.endsWith('getPhotos') || query.name.endsWith('getDetails'))).toBe(false)
  expect(screen.queryAllByRole('img')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Open estimate' }))
  expect(mocks.queries.some((query) => query.name.endsWith('getDetails'))).toBe(true)
  expect(screen.getAllByRole('img')).toHaveLength(1)
})
test('each active estimate has a working archive action', async () => {
  render(<EstimateLeads />)
  expect(screen.getAllByRole('button', { name: 'Archive' })).toHaveLength(12)
  await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0]))
  expect(mocks.mutate).toHaveBeenCalledWith({ id: 'lead-0' })
})
