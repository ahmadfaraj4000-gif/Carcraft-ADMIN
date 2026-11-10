// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ save: vi.fn(), upload: vi.fn(), other: vi.fn() }))
vi.mock('convex/react', () => ({ useMutation: (name) => name === 'save' ? mocks.save : name === 'upload' ? mocks.upload : mocks.other }))
vi.mock('../convex/_generated/api', () => ({ api: { inventory: { save: 'save', generateUploadUrl: 'upload', archive: 'archive', remove: 'remove', removeMany: 'removeMany' } } }))
import InventoryManager from '../src/components/InventoryManager'
const stats = { activeVehicles: 1, featuredVehicles:0, soldVehicles:0, comingSoonVehicles:0 }
const car = { _id:'existing', year:'2013',make:'Hyundai',model:'Veloster',titleStatus:'Clean Title',status:'available',featured:false,sortOrder:100,photos:[{storageId:'saved-photo',name:'original.jpg',url:'https://example.com/original.jpg',order:0}] }
function mount(vehicles = []) { return render(<InventoryManager vehicles={vehicles} stats={stats} />) }
function fillVehicle() {
  fireEvent.change(screen.getByLabelText(/^year$/i), {target:{value:'2013'}})
  fireEvent.change(screen.getByLabelText(/^make$/i), {target:{value:'Hyundai'}})
  fireEvent.change(screen.getByLabelText(/^model$/i), {target:{value:'Veloster'}})
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.save.mockResolvedValue('saved-id')
  mocks.upload.mockResolvedValue('https://example.com/upload')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>({storageId:'new-photo'})}))
  URL.createObjectURL = vi.fn(()=>'blob:preview')
  URL.revokeObjectURL = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {cleanup(); vi.unstubAllGlobals()})
describe('Inventory photo management', () => {
  it('appends multiple new images to existing photos instead of replacing them', async () => {
    mount([car]); fireEvent.click(screen.getByText('Edit'))
    fireEvent.change(screen.getByLabelText('Add photos'), { target:{ files:[new File(['a'],'a.jpg',{type:'image/jpeg'}), new File(['b'],'b.png',{type:'image/png'})] } })
    fireEvent.click(screen.getByText('Save Vehicle'))
    await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1))
    const saved = mocks.save.mock.calls[0][0]
    expect(saved.id).toBe('existing')
    expect(saved.photos.map(p=>p.name)).toEqual(['original.jpg','a.jpg','b.png'])
    expect(saved.photos.map(p=>p.order)).toEqual([0,1,2])
    await screen.findByRole('status')
  })
  it('supports saving successive independent cars', async () => {
    mount(); fillVehicle(); fireEvent.click(screen.getByText('Save Vehicle'))
    await screen.findByRole('status')
    expect(screen.getByLabelText(/^year$/i).value).toBe('')
    fillVehicle(); fireEvent.change(screen.getByLabelText(/^model$/i), {target:{value:'Elantra'}})
    fireEvent.click(screen.getByText('Save Vehicle'))
    await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(2))
    expect(mocks.save.mock.calls[0][0].id).toBeUndefined()
    expect(mocks.save.mock.calls[1][0].id).toBeUndefined()
    expect(mocks.save.mock.calls[1][0].model).toBe('Elantra')
  })
  it('rejects PDF files with a useful error', () => {
    mount(); fireEvent.change(screen.getByLabelText('Add photos'), {target:{files:[new File(['pdf'],'car.pdf',{type:'application/pdf'})]}})
    expect(screen.getByRole('alert').textContent).toContain('PDF documents cannot be displayed')
    expect(screen.getByText('0 photos selected')).toBeTruthy()
  })
  it('keeps details and selected photos after a failed upload, allowing retry', async () => {
    fetch.mockResolvedValueOnce({ok:false})
    mount(); fillVehicle()
    fireEvent.change(screen.getByLabelText('Add photos'), {target:{files:[new File(['a'],'a.jpg',{type:'image/jpeg'})]}})
    fireEvent.click(screen.getByText('Save Vehicle'))
    await screen.findByRole('alert')
    expect(screen.getByLabelText(/^model$/i).value).toBe('Veloster')
    expect(screen.getByText('1 photo selected')).toBeTruthy()
    expect(mocks.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Save Vehicle'))
    await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1))
  })
  it('removes and reorders saved photos without affecting other cars', async () => {
    mount([{...car,photos:[...car.photos,{storageId:'second',name:'second.jpg',url:'https://example.com/2.jpg',order:1}]}])
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.click(screen.getByLabelText('Move saved photo 2 earlier'))
    fireEvent.click(screen.getByLabelText('Remove saved photo 2'))
    fireEvent.click(screen.getByText('Save Vehicle'))
    await waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save.mock.calls[0][0].photos).toEqual([{storageId:'second',name:'second.jpg',order:0}])
  })
})
