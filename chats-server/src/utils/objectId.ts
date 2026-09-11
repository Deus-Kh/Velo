/** True for a canonical 24-hex-character MongoDB ObjectId string. */
export function isValidObjectIdString(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}
