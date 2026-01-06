import Conf from 'conf'
import type { DeviceConfig, PrinterConfig } from '../types/index.js'

interface StoredConfig {
  deviceId?: string
  deviceToken?: string
  restaurantId?: string
  restaurantName?: string
  supabaseUrl?: string
  supabaseKey?: string
  printer?: PrinterConfig
  setupCompleted?: boolean
  lastHeartbeat?: string
}

const config = new Conf<StoredConfig>({
  projectName: 'bitsperbox',
  defaults: {
    setupCompleted: false,
  },
})

export function isConfigured(): boolean {
  return config.get('setupCompleted') === true
}

export function getConfig(): DeviceConfig | null {
  if (!isConfigured()) {
    return null
  }

  const deviceId = config.get('deviceId')
  const deviceToken = config.get('deviceToken')
  const restaurantId = config.get('restaurantId')
  const supabaseUrl = config.get('supabaseUrl')
  const supabaseKey = config.get('supabaseKey')

  if (!deviceId || !deviceToken || !restaurantId || !supabaseUrl || !supabaseKey) {
    return null
  }

  return {
    deviceId,
    deviceToken,
    restaurantId,
    restaurantName: config.get('restaurantName'),
    supabaseUrl,
    supabaseKey,
    printer: config.get('printer'),
  }
}

export function saveConfig(deviceConfig: Partial<DeviceConfig>) {
  if (deviceConfig.deviceId) config.set('deviceId', deviceConfig.deviceId)
  if (deviceConfig.deviceToken) config.set('deviceToken', deviceConfig.deviceToken)
  if (deviceConfig.restaurantId) config.set('restaurantId', deviceConfig.restaurantId)
  if (deviceConfig.restaurantName) config.set('restaurantName', deviceConfig.restaurantName)
  if (deviceConfig.supabaseUrl) config.set('supabaseUrl', deviceConfig.supabaseUrl)
  if (deviceConfig.supabaseKey) config.set('supabaseKey', deviceConfig.supabaseKey)
  if (deviceConfig.printer) config.set('printer', deviceConfig.printer)
  config.set('setupCompleted', true)
}

export function savePrinterConfig(printer: PrinterConfig) {
  config.set('printer', printer)
}

export function clearConfig() {
  config.clear()
}

export function getConfigPath(): string {
  return config.path
}

export function updateLastHeartbeat() {
  config.set('lastHeartbeat', new Date().toISOString())
}

export default config
