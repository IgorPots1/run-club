import { Capacitor } from '@capacitor/core'

export function isNativeCapacitorApp() {
  return Capacitor.isNativePlatform()
}
