import { execFileSync } from 'node:child_process'
import sharp from 'sharp'

const deployment = process.argv[2]
if (!deployment) throw new Error('Usage: node scripts/backfill-estimate-thumbnails.mjs <deployment-name>')
function run(name, args) {
  return JSON.parse(execFileSync(process.execPath, ['node_modules/convex/bin/main.js', 'run', name, JSON.stringify(args), '--deployment', deployment], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }))
}
let cursor = null
let count = 0
let skipped = 0
let originalBytes = 0
let thumbnailBytes = 0
do {
  const batch = run('estimatePhotoMaintenance:batch', { paginationOpts: { cursor, numItems: 5 } })
  for (const photo of batch.photos) {
    try {
      const response = await fetch(photo.url)
      if (!response.ok) throw new Error(`Download returned ${response.status}`)
      const original = Buffer.from(await response.arrayBuffer())
      const thumbnail = await sharp(original).rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer()
      const uploadUrl = run('estimatePhotoMaintenance:uploadUrl', {})
      const uploaded = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': 'image/webp' }, body: thumbnail })
      if (!uploaded.ok) throw new Error(`Upload returned ${uploaded.status}`)
      const { storageId } = await uploaded.json()
      if (run('estimatePhotoMaintenance:attach', { leadId: photo.leadId, storageId: photo.storageId, thumbnailStorageId: storageId })) {
        count++
        originalBytes += original.length
        thumbnailBytes += thumbnail.length
      }
    } catch (error) {
      skipped++
      console.error(`Skipped photo ${photo.storageId}: ${error.message}`)
    }
  }
  console.log(JSON.stringify({ count, skipped, originalBytes, thumbnailBytes }))
  cursor = batch.isDone ? null : batch.continueCursor
} while (cursor)
