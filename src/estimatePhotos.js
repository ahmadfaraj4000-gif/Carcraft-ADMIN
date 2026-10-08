import './secureTransport.js'
// Shared by the public funnel and the React form. Originals are never altered.
;(function (root) {
  async function makeThumbnail(file) {
    let bitmap
    let objectUrl
    try {
      if (typeof createImageBitmap === 'function') {
        try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { /* Try the browser image decoder below. */ }
      }
      if (!bitmap) {
        objectUrl = URL.createObjectURL(file)
        bitmap = await new Promise((resolve, reject) => {
          const image = new Image()
          image.onload = () => resolve(image)
          image.onerror = reject
          image.src = objectUrl
        })
      }
      const width = bitmap.naturalWidth || bitmap.width
      const height = bitmap.naturalHeight || bitmap.height
      const scale = Math.min(1, 640 / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext('2d')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88))
      return blob && blob.size < file.size ? blob : null
    } catch {
      // Unsupported formats (e.g. HEIC on some browsers) must not lose the lead.
      return null
    } finally {
      bitmap?.close?.()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }

  async function uploadPhoto({ file, order, getUploadUrl, attachPhoto, state }) {
    // Persist IDs before attaching so a retry cannot upload the original twice.
    async function upload(blob) {
      const url = root.CarCraftTransport.requireHttpsUrl(await getUploadUrl())
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob
      })
      if (!response.ok) throw new Error('Photo upload failed. Please try again.')
      const { storageId } = await response.json()
      if (!storageId) throw new Error('Photo upload was not confirmed. Please try again.')
      return storageId
    }
    root.CarCraftTransport.requireSecurePage()
    if (state.attached) return
    if (!state.storageId) state.storageId = await upload(file)
    if (!state.thumbnailAttempted) {
      const thumbnail = await makeThumbnail(file)
      if (thumbnail) {
        try { state.thumbnailStorageId = await upload(thumbnail) }
        catch { /* An optional preview failure must not block the original. */ }
      }
      state.thumbnailAttempted = true
    }
    await attachPhoto({
      storageId: state.storageId,
      ...(state.thumbnailStorageId ? { thumbnailStorageId: state.thumbnailStorageId } : {}),
      name: file.name, order
    })
    state.attached = true
  }
  root.CarCraftPhotos = { makeThumbnail, uploadPhoto }
})(globalThis)
