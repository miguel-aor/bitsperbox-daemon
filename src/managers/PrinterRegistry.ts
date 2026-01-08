import { PrinterManager } from './PrinterManager.js'
import { logger } from '../utils/logger.js'
import type {
  LocalPrinter,
  PrinterAssignment,
  PrinterRole,
  PrinterConfig,
  StationTicket,
  MultiPrintResult,
} from '../types/index.js'

/**
 * Instancia de impresora con su manager y metadata
 */
interface PrinterInstance {
  config: LocalPrinter
  manager: PrinterManager
  lastUsed?: Date
  status: 'ready' | 'error' | 'disconnected'
}

/**
 * PrinterRegistry - Gestiona múltiples impresoras y sus asignaciones
 *
 * Ejemplo de uso:
 * ```typescript
 * const registry = new PrinterRegistry()
 *
 * // Registrar impresoras físicas
 * registry.registerPrinter({ id: 'usb-1', name: 'Epson', type: 'usb', ... })
 * registry.registerPrinter({ id: 'net-1', name: 'Star', type: 'network', ip: '192.168.1.50', port: 9100 })
 *
 * // Asignar roles
 * registry.setAssignments([
 *   { role: 'customer_ticket', localPrinterId: 'usb-1', cashDrawerEnabled: true },
 *   { role: 'kitchen_default', localPrinterId: 'net-1' },
 * ])
 *
 * // Imprimir por rol
 * await registry.printByRole('customer_ticket', escposData)
 * ```
 */
export class PrinterRegistry {
  private printers: Map<string, PrinterInstance> = new Map()
  private assignments: PrinterAssignment[] = []
  private defaultPrinterId: string | null = null

  constructor() {
    logger.info('PrinterRegistry initialized')
  }

  // ============================================
  // Registro de Impresoras
  // ============================================

  /**
   * Registrar una impresora física
   */
  registerPrinter(config: LocalPrinter): void {
    // Convertir LocalPrinter a PrinterConfig para el manager
    const printerConfig: PrinterConfig = {
      type: config.type,
      vendorId: config.vendorId,
      productId: config.productId,
      ip: config.ip,
      port: config.port,
      bluetoothAddress: config.bluetoothAddress,
      bluetoothName: config.bluetoothName,
    }

    const manager = new PrinterManager(printerConfig)

    this.printers.set(config.id, {
      config,
      manager,
      status: 'disconnected',
    })

    // Si es la primera impresora, usarla como default
    if (this.printers.size === 1) {
      this.defaultPrinterId = config.id
    }

    logger.info(`Registered printer: ${config.name} (${config.id}) - ${config.type}`)
  }

  /**
   * Eliminar una impresora del registro
   */
  unregisterPrinter(id: string): void {
    if (this.printers.has(id)) {
      this.printers.delete(id)
      logger.info(`Unregistered printer: ${id}`)

      // Limpiar asignaciones que referencian esta impresora
      this.assignments = this.assignments.filter(a => a.localPrinterId !== id)

      // Actualizar default si era esta impresora
      if (this.defaultPrinterId === id) {
        this.defaultPrinterId = this.printers.size > 0 ? Array.from(this.printers.keys())[0] : null
      }
    }
  }

  /**
   * Obtener todas las impresoras registradas
   */
  getAllPrinters(): LocalPrinter[] {
    return Array.from(this.printers.values()).map(p => p.config)
  }

  /**
   * Obtener una impresora por ID
   */
  getPrinter(id: string): PrinterManager | null {
    return this.printers.get(id)?.manager ?? null
  }

  /**
   * Obtener impresora por defecto
   */
  getDefaultPrinter(): PrinterManager | null {
    if (!this.defaultPrinterId) return null
    return this.printers.get(this.defaultPrinterId)?.manager ?? null
  }

  /**
   * Establecer impresora por defecto
   */
  setDefaultPrinter(id: string): void {
    if (this.printers.has(id)) {
      this.defaultPrinterId = id
      logger.info(`Default printer set to: ${id}`)
    }
  }

  // ============================================
  // Asignaciones de Roles
  // ============================================

  /**
   * Cargar asignaciones de roles
   */
  setAssignments(assignments: PrinterAssignment[]): void {
    this.assignments = assignments
    logger.info(`Loaded ${assignments.length} printer assignments`)

    for (const assignment of assignments) {
      const printer = this.printers.get(assignment.localPrinterId)
      if (assignment.role === 'station') {
        logger.debug(`  Station "${assignment.stationName}" → ${printer?.config.name ?? 'NOT FOUND'}`)
      } else {
        logger.debug(`  ${assignment.role} → ${printer?.config.name ?? 'NOT FOUND'}`)
      }
    }
  }

  /**
   * Obtener todas las asignaciones
   */
  getAssignments(): PrinterAssignment[] {
    return [...this.assignments]
  }

  /**
   * Obtener asignación por rol
   */
  getAssignment(role: PrinterRole, stationId?: string): PrinterAssignment | undefined {
    if (role === 'station' && stationId) {
      return this.assignments.find(a => a.role === 'station' && a.stationId === stationId)
    }
    return this.assignments.find(a => a.role === role)
  }

  /**
   * Agregar o actualizar una asignación
   */
  setAssignment(assignment: PrinterAssignment): void {
    // Remover asignación existente para el mismo rol/estación
    if (assignment.role === 'station') {
      this.assignments = this.assignments.filter(
        a => !(a.role === 'station' && a.stationId === assignment.stationId)
      )
    } else {
      this.assignments = this.assignments.filter(a => a.role !== assignment.role)
    }

    this.assignments.push(assignment)
    logger.info(`Assignment set: ${assignment.role} → ${assignment.localPrinterId}`)
  }

  /**
   * Eliminar una asignación
   */
  removeAssignment(role: PrinterRole, stationId?: string): void {
    if (role === 'station' && stationId) {
      this.assignments = this.assignments.filter(
        a => !(a.role === 'station' && a.stationId === stationId)
      )
    } else {
      this.assignments = this.assignments.filter(a => a.role !== role)
    }
  }

  // ============================================
  // Búsqueda por Rol
  // ============================================

  /**
   * Obtener impresora asignada a un rol
   */
  getPrinterForRole(role: PrinterRole): PrinterManager | null {
    const assignment = this.assignments.find(a => a.role === role)
    if (!assignment) {
      logger.debug(`No assignment for role: ${role}, using default`)
      return this.getDefaultPrinter()
    }

    const printer = this.printers.get(assignment.localPrinterId)
    if (!printer) {
      logger.warn(`Assigned printer not found: ${assignment.localPrinterId}, using default`)
      return this.getDefaultPrinter()
    }

    return printer.manager
  }

  /**
   * Obtener impresora asignada a una estación de cocina
   */
  getPrinterForStation(stationId: string): PrinterManager | null {
    const assignment = this.assignments.find(a => a.role === 'station' && a.stationId === stationId)
    if (!assignment) {
      logger.debug(`No assignment for station: ${stationId}, using kitchen_default`)
      return this.getPrinterForRole('kitchen_default')
    }

    const printer = this.printers.get(assignment.localPrinterId)
    if (!printer) {
      logger.warn(`Station printer not found: ${assignment.localPrinterId}, using kitchen_default`)
      return this.getPrinterForRole('kitchen_default')
    }

    return printer.manager
  }

  // ============================================
  // Operaciones de Impresión
  // ============================================

  /**
   * Imprimir por ID de impresora
   */
  async print(printerId: string, data: Buffer): Promise<boolean> {
    const instance = this.printers.get(printerId)
    if (!instance) {
      logger.error(`Printer not found: ${printerId}`)
      return false
    }

    const success = await instance.manager.print(data)
    if (success) {
      instance.lastUsed = new Date()
      instance.status = 'ready'
    } else {
      instance.status = 'error'
    }

    return success
  }

  /**
   * Imprimir base64 por ID de impresora
   */
  async printBase64(printerId: string, base64Data: string): Promise<boolean> {
    const buffer = Buffer.from(base64Data, 'base64')
    return this.print(printerId, buffer)
  }

  /**
   * Imprimir por rol
   */
  async printByRole(role: PrinterRole, data: Buffer, stationId?: string): Promise<MultiPrintResult> {
    let printer: PrinterManager | null
    let assignment: PrinterAssignment | undefined

    if (role === 'station' && stationId) {
      printer = this.getPrinterForStation(stationId)
      assignment = this.getAssignment('station', stationId)
    } else {
      printer = this.getPrinterForRole(role)
      assignment = this.getAssignment(role)
    }

    if (!printer) {
      return {
        success: false,
        printerId: '',
        printerName: '',
        error: `No printer available for role: ${role}`,
      }
    }

    const printerId = assignment?.localPrinterId ?? this.defaultPrinterId ?? ''
    const instance = this.printers.get(printerId)

    const success = await printer.print(data)

    return {
      success,
      printerId,
      printerName: instance?.config.name ?? 'Unknown',
      error: success ? undefined : 'Print failed',
    }
  }

  /**
   * Imprimir base64 por rol
   */
  async printBase64ByRole(
    role: PrinterRole,
    base64Data: string,
    stationId?: string
  ): Promise<MultiPrintResult> {
    const buffer = Buffer.from(base64Data, 'base64')
    return this.printByRole(role, buffer, stationId)
  }

  /**
   * Imprimir tickets de estación (múltiples tickets a diferentes impresoras)
   */
  async printStationTickets(tickets: StationTicket[]): Promise<MultiPrintResult[]> {
    const results: MultiPrintResult[] = []

    for (const ticket of tickets) {
      const copies = ticket.printerConfig?.copies ?? 1

      for (let i = 0; i < copies; i++) {
        const result = await this.printBase64ByRole('station', ticket.escposBase64, ticket.stationId)
        results.push({
          ...result,
          printerName: `${result.printerName} (${ticket.stationName})`,
        })
      }
    }

    return results
  }

  /**
   * Abrir cajón de efectivo en una impresora específica
   */
  async openCashDrawer(printerId: string): Promise<boolean> {
    const instance = this.printers.get(printerId)
    if (!instance) {
      logger.error(`Printer not found for cash drawer: ${printerId}`)
      return false
    }

    // ESC/POS comando para abrir cajón (pin 2)
    // ESC p m t1 t2 - donde m=0 (pin 2), t1=25 (on time), t2=250 (off time)
    const cashDrawerCommand = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])

    const success = await instance.manager.print(cashDrawerCommand)
    if (success) {
      logger.success(`Cash drawer opened on: ${instance.config.name}`)
    } else {
      logger.error(`Failed to open cash drawer on: ${instance.config.name}`)
    }

    return success
  }

  /**
   * Abrir cajón de efectivo por rol (customer_ticket normalmente)
   */
  async openCashDrawerByRole(role: PrinterRole = 'customer_ticket'): Promise<boolean> {
    const assignment = this.getAssignment(role)
    if (!assignment) {
      logger.warn(`No assignment for cash drawer role: ${role}`)
      // Intentar con la impresora por defecto
      if (this.defaultPrinterId) {
        return this.openCashDrawer(this.defaultPrinterId)
      }
      return false
    }

    return this.openCashDrawer(assignment.localPrinterId)
  }

  // ============================================
  // Testing y Estado
  // ============================================

  /**
   * Probar conexión de una impresora específica
   */
  async testPrinter(printerId: string): Promise<boolean> {
    const instance = this.printers.get(printerId)
    if (!instance) {
      logger.error(`Printer not found for testing: ${printerId}`)
      return false
    }

    const success = await instance.manager.testConnection()
    instance.status = success ? 'ready' : 'disconnected'

    return success
  }

  /**
   * Probar todas las impresoras
   */
  async testAllPrinters(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>()

    for (const [id, instance] of this.printers) {
      const success = await instance.manager.testConnection()
      instance.status = success ? 'ready' : 'disconnected'
      results.set(id, success)
    }

    return results
  }

  /**
   * Imprimir página de prueba en una impresora específica
   */
  async printTestPage(printerId: string): Promise<boolean> {
    const instance = this.printers.get(printerId)
    if (!instance) {
      logger.error(`Printer not found for test page: ${printerId}`)
      return false
    }

    return instance.manager.printTestPage()
  }

  /**
   * Obtener estado de todas las impresoras
   */
  getStatus(): Map<string, { config: LocalPrinter; status: string; lastUsed?: Date }> {
    const status = new Map()
    for (const [id, instance] of this.printers) {
      status.set(id, {
        config: instance.config,
        status: instance.status,
        lastUsed: instance.lastUsed,
      })
    }
    return status
  }

  /**
   * Obtener resumen para logging
   */
  getSummary(): string {
    const printerCount = this.printers.size
    const assignmentCount = this.assignments.length
    const defaultName = this.defaultPrinterId
      ? this.printers.get(this.defaultPrinterId)?.config.name
      : 'none'

    return `PrinterRegistry: ${printerCount} printers, ${assignmentCount} assignments, default: ${defaultName}`
  }

  // ============================================
  // Migración y Compatibilidad
  // ============================================

  /**
   * Crear registry desde una sola impresora (backward compatibility)
   */
  static fromSinglePrinter(config: PrinterConfig, name: string = 'Default Printer'): PrinterRegistry {
    const registry = new PrinterRegistry()

    const localPrinter: LocalPrinter = {
      id: 'legacy-default',
      name,
      type: config.type,
      vendorId: config.vendorId,
      productId: config.productId,
      ip: config.ip,
      port: config.port,
      bluetoothAddress: config.bluetoothAddress,
      bluetoothName: config.bluetoothName,
    }

    registry.registerPrinter(localPrinter)

    // Asignar a todos los roles
    registry.setAssignments([
      { role: 'customer_ticket', localPrinterId: 'legacy-default', cashDrawerEnabled: true },
      { role: 'kitchen_default', localPrinterId: 'legacy-default' },
      { role: 'fiscal', localPrinterId: 'legacy-default' },
    ])

    logger.info('Created PrinterRegistry from legacy single printer config')

    return registry
  }
}

export default PrinterRegistry
