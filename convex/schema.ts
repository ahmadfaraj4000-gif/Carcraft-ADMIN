import { defineSchema, defineTable } from 'convex/server'
import { authTables } from '@convex-dev/auth/server'
import { v } from 'convex/values'

const note = v.object({
  body: v.string(),
  createdAt: v.number(),
  createdBy: v.optional(v.id('users'))
})

const photoRef = v.object({
  storageId: v.id('_storage'),
  url: v.optional(v.string()),
  name: v.optional(v.string()),
  order: v.optional(v.number())
})

const vehicleInfo = {
  vehicleYear: v.optional(v.string()),
  vehicleMake: v.optional(v.string()),
  vehicleModel: v.optional(v.string()),
  vehicle: v.optional(v.string()),
  vin: v.optional(v.string()),
  mileage: v.optional(v.string())
}

export default defineSchema({
  ...authTables,
  adminProfiles: defineTable({
    userId: v.id('users'),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('staff')),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index('by_user', ['userId']),
  estimateLeads: defineTable({
    name: v.string(),
    phone: v.string(),
    email: v.string(),
    preferredContactMethod: v.string(),
    ...vehicleInfo,
    damageArea: v.string(),
    damageType: v.string(),
    severity: v.string(),
    description: v.string(),
    status: v.union(
      v.literal('new'),
      v.literal('contacted'),
      v.literal('booked'),
      v.literal('follow_up_needed'),
      v.literal('lost'),
      v.literal('archived')
    ),
    photos: v.array(photoRef),
    notes: v.array(note),
    archived: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index('by_status', ['status']).searchIndex('search_leads', {
    searchField: 'name',
    filterFields: ['status']
  }),
  appointments: defineTable({
    leadId: v.optional(v.id('estimateLeads')),
    customerId: v.optional(v.id('customers')),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    ...vehicleInfo,
    serviceRequested: v.string(),
    appointmentDate: v.string(),
    appointmentTime: v.string(),
    status: v.union(
      v.literal('new_request'),
      v.literal('confirmed'),
      v.literal('car_in_shop'),
      v.literal('waiting_on_parts'),
      v.literal('completed'),
      v.literal('cancelled')
    ),
    photos: v.array(photoRef),
    notes: v.array(note),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index('by_date', ['appointmentDate']).index('by_status', ['status']),
  customers: defineTable({
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    ...vehicleInfo,
    source: v.string(),
    notes: v.optional(v.string()),
    leadIds: v.array(v.id('estimateLeads')),
    appointmentIds: v.array(v.id('appointments')),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index('by_phone', ['phone']).index('by_email', ['email']),
  inventoryVehicles: defineTable({
    year: v.string(),
    make: v.string(),
    model: v.string(),
    price: v.optional(v.string()),
    mileage: v.optional(v.string()),
    color: v.optional(v.string()),
    bodyType: v.optional(v.string()),
    transmission: v.optional(v.string()),
    vin: v.optional(v.string()),
    titleStatus: v.string(),
    status: v.union(v.literal('available'), v.literal('sold'), v.literal('coming_soon'), v.literal('archived')),
    description: v.optional(v.string()),
    featured: v.boolean(),
    sortOrder: v.number(),
    photos: v.array(photoRef),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index('by_status', ['status']).index('by_sort', ['sortOrder']),
  inventoryPhotos: defineTable({
    vehicleId: v.id('inventoryVehicles'),
    storageId: v.id('_storage'),
    name: v.optional(v.string()),
    order: v.number(),
    createdAt: v.number()
  }).index('by_vehicle', ['vehicleId']),
  uploadedPhotos: defineTable({
    storageId: v.id('_storage'),
    ownerType: v.union(v.literal('estimateLead'), v.literal('appointment'), v.literal('inventoryVehicle')),
    ownerId: v.optional(v.string()),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    createdAt: v.number()
  }).index('by_owner', ['ownerType', 'ownerId'])
})
