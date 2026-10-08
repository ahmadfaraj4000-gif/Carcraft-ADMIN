import { afterEach, expect, test, vi } from 'vitest'
import '../src/secureTransport.js'
import '../src/estimatePhotos.js'
const transport = (globalThis as any).CarCraftTransport
const photos = (globalThis as any).CarCraftPhotos

afterEach(() => vi.unstubAllGlobals())

test('customer pages require HTTPS outside local development', () => {
  expect(() => transport.requireSecurePage({ protocol: 'http:', hostname: 'carcraftautobodytowing.com' })).toThrow('HTTPS')
  expect(() => transport.requireSecurePage({ protocol: 'https:', hostname: 'carcraftautobodytowing.com' })).not.toThrow()
  expect(() => transport.requireSecurePage({ protocol: 'http:', hostname: 'localhost' })).not.toThrow()
})

test.each(['http://elated-bee-109.convex.cloud/api/mutation', 'http://elated-bee-109.convex.cloud/api/storage/file', 'ws://elated-bee-109.convex.cloud', '//elated-bee-109.convex.cloud', 'https://user:password@example.com'])('rejects unsafe endpoint %s', (url) => {
  expect(() => transport.requireHttpsUrl(url)).toThrow()
})

test('accepts HTTPS API and storage URLs without altering upload query parameters', () => {
  const url = 'https://elated-bee-109.convex.cloud/api/storage/upload?token=example'
  expect(transport.requireHttpsUrl(url)).toBe(url)
})

test('photo uploader sends no data to an HTTP upload endpoint', async () => {
  vi.stubGlobal('location', { protocol: 'https:', hostname: 'carcraftautobodytowing.com' })
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const attachPhoto = vi.fn()
  await expect(photos.uploadPhoto({ file: new Blob(['test']), order: 0, state: {}, getUploadUrl: async () => 'http://example.com/upload', attachPhoto })).rejects.toThrow('insecure connection')
  expect(fetch).not.toHaveBeenCalled()
  expect(attachPhoto).not.toHaveBeenCalled()
})

test('photo uploader refuses production HTTP pages before requesting an upload URL', async () => {
  vi.stubGlobal('location', { protocol: 'http:', hostname: 'carcraftautobodytowing.com' })
  const getUploadUrl = vi.fn()
  await expect(photos.uploadPhoto({ file: new Blob(['test']), order: 0, state: {}, getUploadUrl, attachPhoto: vi.fn() })).rejects.toThrow('HTTPS')
  expect(getUploadUrl).not.toHaveBeenCalled()
})

test('HTTPS upload rejects redirects and preserves successful submission behavior', async () => {
  vi.stubGlobal('location', { protocol: 'https:', hostname: 'carcraftautobodytowing.com' })
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ storageId: 'test-photo' }) }))
  vi.stubGlobal('fetch', fetch)
  const attachPhoto = vi.fn()
  const file = Object.assign(new Blob(['test'], { type: 'image/png' }), { name: 'test.png' })
  await photos.uploadPhoto({ file, order: 0, state: { thumbnailAttempted: true }, getUploadUrl: async () => 'https://elated-bee-109.convex.cloud/upload', attachPhoto })
  expect(fetch).toHaveBeenCalledWith('https://elated-bee-109.convex.cloud/upload', expect.objectContaining({ redirect: 'error', body: file }))
  expect(attachPhoto).toHaveBeenCalledWith({ storageId: 'test-photo', name: 'test.png', order: 0 })
})
