import * as Crypto from 'expo-crypto';

// RFC 4122 v4 UUID for client_message_id (idempotent send + retry).
export function newClientMessageId(): string {
  return Crypto.randomUUID();
}
