import type { CapacitorConfig } from '@capacitor/cli'

const remoteAppUrl = process.env.CAPACITOR_APP_URL?.trim() || process.env.APP_URL?.trim() || ''

const config: CapacitorConfig = {
  appId: 'app.runclub.iosshell',
  appName: 'Run Club',
  webDir: 'capacitor-fallback',
}

if (remoteAppUrl) {
  config.server = {
    url: remoteAppUrl,
    cleartext: false,
  }
}

export default config
