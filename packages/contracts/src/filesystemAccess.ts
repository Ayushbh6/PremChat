import { z } from "zod"

export const filesystemAccessModeSchema = z.enum(["read_only", "selected", "full"])
export type FilesystemAccessMode = z.infer<typeof filesystemAccessModeSchema>

export const filesystemRootStatusSchema = z.enum(["active", "missing", "revoked"])
export type FilesystemRootStatus = z.infer<typeof filesystemRootStatusSchema>

export const filesystemRootSourceSchema = z.enum(["user", "legacy_project"])
export type FilesystemRootSource = z.infer<typeof filesystemRootSourceSchema>

export const filesystemRootSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    path: z.string().min(1),
    isDefault: z.boolean(),
    status: filesystemRootStatusSchema,
    source: filesystemRootSourceSchema,
    sourceProjectId: z.string().min(1).nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    revokedAt: z.string().min(1).nullable(),
  })
  .strict()
export type FilesystemRoot = z.infer<typeof filesystemRootSchema>

export const filesystemAuthorizedRootSchema = filesystemRootSchema.pick({
  id: true,
  label: true,
  path: true,
})
export type FilesystemAuthorizedRoot = z.infer<typeof filesystemAuthorizedRootSchema>

export const filesystemAccessStateSchema = z
  .object({
    mode: filesystemAccessModeSchema,
    revision: z.number().int().positive(),
    roots: z.array(filesystemRootSchema),
    updatedAt: z.string().min(1),
  })
  .strict()
export type FilesystemAccessState = z.infer<typeof filesystemAccessStateSchema>

export const filesystemAuthorizationSnapshotSchema = z
  .object({
    id: z.string().min(1),
    turnId: z.string().min(1),
    mode: filesystemAccessModeSchema,
    revision: z.number().int().positive(),
    roots: z.array(filesystemAuthorizedRootSchema),
    workingRootPath: z.string().min(1).nullable(),
    createdAt: z.string().min(1),
  })
  .strict()
export type FilesystemAuthorizationSnapshot = z.infer<typeof filesystemAuthorizationSnapshotSchema>

export const updateFilesystemAccessRequestSchema = z
  .object({
    mode: filesystemAccessModeSchema,
  })
  .strict()
export type UpdateFilesystemAccessRequest = z.infer<typeof updateFilesystemAccessRequestSchema>

export const addFilesystemRootRequestSchema = z
  .object({
    path: z.string().min(1),
    label: z.string().trim().min(1).max(120).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
export type AddFilesystemRootRequest = z.infer<typeof addFilesystemRootRequestSchema>

export const updateFilesystemRootRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.label !== undefined || value.isDefault !== undefined, "Provide at least one root update.")
export type UpdateFilesystemRootRequest = z.infer<typeof updateFilesystemRootRequestSchema>

export const updateFilesystemRootCommandSchema = z
  .object({
    rootId: z.string().min(1),
    input: updateFilesystemRootRequestSchema,
  })
  .strict()

export const removeFilesystemRootCommandSchema = z
  .object({
    rootId: z.string().min(1),
  })
  .strict()

export const getFilesystemAccessResponseSchema = filesystemAccessStateSchema
export type GetFilesystemAccessResponse = FilesystemAccessState

export const updateFilesystemAccessResponseSchema = filesystemAccessStateSchema
export type UpdateFilesystemAccessResponse = FilesystemAccessState

export const addFilesystemRootResponseSchema = z
  .object({
    access: filesystemAccessStateSchema,
    root: filesystemRootSchema,
  })
  .strict()
export type AddFilesystemRootResponse = z.infer<typeof addFilesystemRootResponseSchema>

export const updateFilesystemRootResponseSchema = addFilesystemRootResponseSchema
export type UpdateFilesystemRootResponse = AddFilesystemRootResponse

export const removeFilesystemRootResponseSchema = z
  .object({
    access: filesystemAccessStateSchema,
    removedRootId: z.string().min(1),
  })
  .strict()
export type RemoveFilesystemRootResponse = z.infer<typeof removeFilesystemRootResponseSchema>
