import { SUPABASE_URL } from './supabase'

/**
 * Turns whatever is stored in the database for an image into something <Image> can actually load.
 *  - full http(s) / data: / file: URLs are kept (spaces are percent-encoded, which Android requires)
 *  - "//host/path" gets https:
 *  - anything else is treated as a Supabase Storage object path ("bucket/folder/file.png")
 */
export function resolveImageUrl(raw) {
  if (!raw || typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value) return null
  if (/^data:/i.test(value) || /^file:/i.test(value)) return value

  const encode = (u) => (/\s/.test(u) && !/%[0-9a-f]{2}/i.test(u) ? encodeURI(u) : u.replace(/\s/g, '%20'))

  if (/^https?:\/\//i.test(value)) return encode(value)
  if (value.startsWith('//')) return encode('https:' + value)

  const objectPath = value.replace(/^\/+/, '').replace(/^storage\/v1\/object\/(public\/)?/, '')
  return encode(`${SUPABASE_URL}/storage/v1/object/public/${objectPath}`)
}
