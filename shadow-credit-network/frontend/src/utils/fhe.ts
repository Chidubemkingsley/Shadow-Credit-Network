import { ethers } from 'ethers'
import { EncryptedItemInput } from '@cofhe/sdk'

export function formatEncryptedInput(
  encrypted: EncryptedItemInput
): [bigint, number, number, Uint8Array] {
  return [
    encrypted.ctHash,
    encrypted.securityZone,
    encrypted.utype,
    ethers.getBytes(encrypted.signature),
  ]
}