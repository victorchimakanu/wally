import type { PhoneRuntime, PhoneStatus } from './phone-runtime';

export const phoneAvailable = false;
export function phoneCompatibility() { return { supported: false, reason: 'Phone-local QVAC requires a physical Android device and a native Wally build.' }; }
export async function getPhoneRuntime(_onStatus?: (status: PhoneStatus) => void): Promise<PhoneRuntime> {
  throw new Error(phoneCompatibility().reason);
}
export async function phoneSnapshot(): Promise<unknown> { return { supported: false }; }
