// Card address ("slug") clean-up, so what the owner types always becomes a valid web address part.

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

/** Make typed text a valid slug: lower case, letters, numbers and single dashes. */
export function normaliseSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^[^/]*\/(c\/)?/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** True when a slug is long enough and only has allowed characters. */
export function isValidSlug(slug: string): boolean {
  return slug.length >= SLUG_MIN && slug.length <= SLUG_MAX && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}
