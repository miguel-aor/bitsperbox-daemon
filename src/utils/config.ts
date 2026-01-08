import Conf from 'conf'
import type { DeviceConfig, PrinterConfig, LocalPrinter, PrinterAssignment } from '../types/index.js'

interface StoredConfig {
  deviceId?: string
  deviceToken?: string
  restaurantId?: string
  restaurantName?: string
  supabaseUrl?: string
  supabaseKey?: string
  frontendUrl?: string
  // Legacy single printer (backward compatibility)
  printer?: PrinterConfig
  // Multi-printer support
  localPrinters?: LocalPrinter[]
  printerAssignments?: PrinterAssignment[]
  syncWithDashboard?: boolean
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
  const frontendUrl = config.get('frontendUrl')

  if (!deviceId || !deviceToken || !restaurantId || !supabaseUrl || !supabaseKey || !frontendUrl) {
    return null
  }

  return {
    deviceId,
    deviceToken,
    restaurantId,
    restaurantName: config.get('restaurantName'),
    supabaseUrl,
    supabaseKey,
    frontendUrl,
    printer: config.get('printer'),
    localPrinters: config.get('localPrinters'),
    printerAssignments: config.get('printerAssignments'),
    syncWithDashboard: config.get('syncWithDashboard'),
  }
}

export function saveConfig(deviceConfig: Partial<DeviceConfig>) {
  if (deviceConfig.deviceId) config.set('deviceId', deviceConfig.deviceId)
  if (deviceConfig.deviceToken) config.set('deviceToken', deviceConfig.deviceToken)
  if (deviceConfig.restaurantId) config.set('restaurantId', deviceConfig.restaurantId)
  if (deviceConfig.restaurantName) config.set('restaurantName', deviceConfig.restaurantName)
  if (deviceConfig.supabaseUrl) config.set('supabaseUrl', deviceConfig.supabaseUrl)
  if (deviceConfig.supabaseKey) config.set('supabaseKey', deviceConfig.supabaseKey)
  if (deviceConfig.frontendUrl) config.set('frontendUrl', deviceConfig.frontendUrl)
  if (deviceConfig.printer) config.set('printer', deviceConfig.printer)
  if (deviceConfig.localPrinters !== undefined) config.set('localPrinters', deviceConfig.localPrinters)
  if (deviceConfig.printerAssignments !== undefined) config.set('printerAssignments', deviceConfig.printerAssignments)
  if (deviceConfig.syncWithDashboard !== undefined) config.set('syncWithDashboard', deviceConfig.syncWithDashboard)
  config.set('setupCompleted', true)
}

export function savePrinterConfig(printer: PrinterConfig) {
  config.set('printer', printer)
}

// ============================================
// Multi-Printer Config Functions
// ============================================

/**
 * Guardar lista de impresoras locales
 */
export function saveLocalPrinters(printers: LocalPrinter[]) {
  config.set('localPrinters', printers)
}

/**
 * Obtener lista de impresoras locales
 */
export function getLocalPrinters(): LocalPrinter[] {
  return config.get('localPrinters') || []
}

/**
 * Agregar una impresora local
 */
export function addLocalPrinter(printer: LocalPrinter) {
  const printers = getLocalPrinters()
  const existingIndex = printers.findIndex(p => p.id === printer.id)
  if (existingIndex >= 0) {
    printers[existingIndex] = printer
  } else {
    printers.push(printer)
  }
  config.set('localPrinters', printers)
}

/**
 * Eliminar una impresora local
 */
export function removeLocalPrinter(printerId: string) {
  const printers = getLocalPrinters().filter(p => p.id !== printerId)
  config.set('localPrinters', printers)

  // También eliminar asignaciones que referencian esta impresora
  const assignments = getPrinterAssignments().filter(a => a.localPrinterId !== printerId)
  config.set('printerAssignments', assignments)
}

/**
 * Guardar asignaciones de impresoras
 */
export function savePrinterAssignments(assignments: PrinterAssignment[]) {
  config.set('printerAssignments', assignments)
}

/**
 * Obtener asignaciones de impresoras
 */
export function getPrinterAssignments(): PrinterAssignment[] {
  return config.get('printerAssignments') || []
}

/**
 * Establecer si sincronizar con dashboard
 */
export function setSyncWithDashboard(enabled: boolean) {
  config.set('syncWithDashboard', enabled)
}

/**
 * Obtener si sincronizar con dashboard
 */
export function getSyncWithDashboard(): boolean {
  return config.get('syncWithDashboard') || false
}

/**
 * Migrar configuración legacy (single printer) a multi-printer
 * Llama esto cuando existe printer pero no localPrinters
 */
export function migrateToMultiPrinter(): boolean {
  const legacyPrinter = config.get('printer')
  const localPrinters = config.get('localPrinters')

  // Ya está migrado o no hay printer legacy
  if (localPrinters && localPrinters.length > 0) {
    return false
  }

  if (!legacyPrinter) {
    return false
  }

  // Crear LocalPrinter desde PrinterConfig
  const migratedPrinter: LocalPrinter = {
    id: 'migrated-default',
    name: legacyPrinter.bluetoothName || legacyPrinter.ip || 'Default Printer',
    type: legacyPrinter.type,
    vendorId: legacyPrinter.vendorId,
    productId: legacyPrinter.productId,
    ip: legacyPrinter.ip,
    port: legacyPrinter.port,
    bluetoothAddress: legacyPrinter.bluetoothAddress,
    bluetoothName: legacyPrinter.bluetoothName,
  }

  // Guardar como primera impresora local
  config.set('localPrinters', [migratedPrinter])

  // Asignar a todos los roles
  const defaultAssignments: PrinterAssignment[] = [
    { role: 'customer_ticket', localPrinterId: 'migrated-default', cashDrawerEnabled: true },
    { role: 'kitchen_default', localPrinterId: 'migrated-default' },
    { role: 'fiscal', localPrinterId: 'migrated-default' },
  ]
  config.set('printerAssignments', defaultAssignments)

  return true
}

/**
 * Verificar si hay configuración multi-printer
 */
export function hasMultiPrinterConfig(): boolean {
  const localPrinters = config.get('localPrinters')
  return localPrinters !== undefined && localPrinters.length > 0
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
