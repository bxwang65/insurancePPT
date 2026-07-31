import assert from "node:assert/strict";
import { canAccessSessionOwner, ownerIdFromHeader, safeOwnerId } from "../src/api/session-access.ts";

assert.equal(ownerIdFromHeader("user_a"), "user_a");
assert.equal(ownerIdFromHeader("   "), "local");
assert.equal(ownerIdFromHeader(undefined), "local");

assert.equal(safeOwnerId("user-a.01"), "user-a.01");
assert.equal(safeOwnerId("../evil\\x00"), ".._evil_x00");
assert.equal(safeOwnerId(""), "local");

assert.equal(canAccessSessionOwner("user_a", "user_a"), true);
assert.equal(canAccessSessionOwner("user_b", "user_a"), false);

console.log(JSON.stringify({
  status: "ok",
  ownerHeaderNormalization: true,
  ownerIdSanitization: true,
  crossOwnerAccessBlocked: true,
}, null, 2));
