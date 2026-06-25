export function ownerIdFromHeader(value: string | null | undefined): string {
  return value?.trim() || "local";
}

export function safeOwnerId(value: string): string {
  return value.replace(/[^\w.-]/g, "_").slice(0, 64) || "local";
}

export function canAccessSessionOwner(requestOwnerId: string, sessionOwnerId: string): boolean {
  return requestOwnerId === sessionOwnerId;
}
