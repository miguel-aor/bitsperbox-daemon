import express, { Request, Response } from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { logger } from '../utils/logger.js'
import {
  getConfig,
  saveConfig,
  savePrinterConfig,
  clearConfig,
  getConfigPath,
  isConfigured,
  getLocalPrinters,
  saveLocalPrinters,
  addLocalPrinter,
  removeLocalPrinter,
  getPrinterAssignments,
  savePrinterAssignments,
  setSyncWithDashboard,
  getSyncWithDashboard,
} from '../utils/config.js'
import { PrinterManager } from '../managers/PrinterManager.js'
import { PrinterRegistry } from '../managers/PrinterRegistry.js'
import { PrintService } from '../services/PrintService.js'
import type {
  DeviceConfig,
  PrinterConfig,
  LocalPrinter,
  PrinterAssignment,
  LocalPrintRequest,
  StationTicketsRequest,
  CashDrawerRequest,
  DiscoveryResponse,
} from '../types/index.js'

// Version for discovery
const FIRMWARE_VERSION = '2.0.0'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Resolve public directory - works in both dev (tsx) and prod (compiled)
function getPublicDir(): string {
  // Try relative to current file first (production)
  const prodPath = path.join(__dirname, 'public')
  if (fs.existsSync(prodPath)) return prodPath

  // Try src/web/public (development with tsx)
  const devPath = path.join(process.cwd(), 'src', 'web', 'public')
  if (fs.existsSync(devPath)) return devPath

  // Fallback
  return prodPath
}

interface WebServerOptions {
  port?: number
  printerManager?: PrinterManager
  printerRegistry?: PrinterRegistry
  printService?: PrintService
  getStatus?: () => StatusInfo
}

interface StatusInfo {
  connected: boolean
  realtimeStatus: string
  lastOrderTime?: string
  ordersProcessed: number
}

export class WebServer {
  private app: express.Application
  private port: number
  private printerManager?: PrinterManager
  private printerRegistry?: PrinterRegistry
  private printService?: PrintService
  private getStatus?: () => StatusInfo
  private server?: ReturnType<typeof this.app.listen>

  constructor(options: WebServerOptions = {}) {
    this.app = express()
    this.port = options.port || 3333
    this.printerManager = options.printerManager
    this.printerRegistry = options.printerRegistry
    this.printService = options.printService
    this.getStatus = options.getStatus

    this.setupMiddleware()
    this.setupRoutes()
  }

  private setupMiddleware() {
    this.app.use(cors())
    this.app.use(express.json())
    const publicDir = getPublicDir()
    logger.info(`Serving static files from: ${publicDir}`)
    this.app.use(express.static(publicDir))
  }

  private setupRoutes() {
    // API Routes

    // Get current configuration status
    this.app.get('/api/status', (_req: Request, res: Response) => {
      const configured = isConfigured()
      const config = getConfig()
      const status = this.getStatus?.() || {
        connected: false,
        realtimeStatus: 'unknown',
        ordersProcessed: 0,
      }

      res.json({
        configured,
        config: config
          ? {
              deviceId: config.deviceId,
              restaurantId: config.restaurantId,
              restaurantName: config.restaurantName,
              frontendUrl: config.frontendUrl,
              hasPrinter: !!config.printer,
            }
          : null,
        status,
        configPath: getConfigPath(),
      })
    })

    // Get full config (for setup form)
    this.app.get('/api/config', (_req: Request, res: Response) => {
      const config = getConfig()
      if (!config) {
        res.json({ configured: false })
        return
      }
      res.json({
        configured: true,
        deviceId: config.deviceId,
        deviceToken: config.deviceToken ? '********' : '',
        restaurantId: config.restaurantId,
        restaurantName: config.restaurantName,
        supabaseUrl: config.supabaseUrl,
        supabaseKey: config.supabaseKey ? '********' : '',
        frontendUrl: config.frontendUrl,
        printer: config.printer,
      })
    })

    // Save configuration
    this.app.post('/api/config', (req: Request, res: Response) => {
      try {
        const {
          deviceId,
          deviceToken,
          restaurantId,
          restaurantName,
          supabaseUrl,
          supabaseKey,
          frontendUrl,
        } = req.body

        if (!deviceId || !deviceToken || !restaurantId || !supabaseUrl || !supabaseKey || !frontendUrl) {
          res.status(400).json({ error: 'Missing required fields' })
          return
        }

        saveConfig({
          deviceId,
          deviceToken,
          restaurantId,
          restaurantName,
          supabaseUrl,
          supabaseKey,
          frontendUrl,
        })

        logger.info('Configuration saved via web UI')
        res.json({ success: true, message: 'Configuration saved. Restart daemon to apply changes.' })
      } catch (error) {
        logger.error('Error saving config', error)
        res.status(500).json({ error: 'Failed to save configuration' })
      }
    })

    // Reset configuration
    this.app.post('/api/config/reset', (_req: Request, res: Response) => {
      try {
        clearConfig()
        logger.info('Configuration reset via web UI')
        res.json({ success: true, message: 'Configuration cleared' })
      } catch (error) {
        logger.error('Error resetting config', error)
        res.status(500).json({ error: 'Failed to reset configuration' })
      }
    })

    // Detect printers
    this.app.get('/api/printers', async (_req: Request, res: Response) => {
      if (!this.printerManager) {
        res.status(503).json({ error: 'Printer manager not available' })
        return
      }

      try {
        const printers = await this.printerManager.detectPrinters()
        res.json({ printers })
      } catch (error) {
        logger.error('Error detecting printers', error)
        res.status(500).json({ error: 'Failed to detect printers' })
      }
    })

    // Save printer configuration (supports USB, Network, Bluetooth)
    this.app.post('/api/printers/config', (req: Request, res: Response) => {
      try {
        const printerConfig: PrinterConfig = req.body

        // Validate based on type
        if (!printerConfig.type) {
          res.status(400).json({ error: 'Missing printer type' })
          return
        }

        if (printerConfig.type === 'usb' && !printerConfig.vendorId) {
          res.status(400).json({ error: 'Missing USB printer vendorId' })
          return
        }

        if (printerConfig.type === 'network' && (!printerConfig.ip || !printerConfig.port)) {
          res.status(400).json({ error: 'Missing network printer IP or port' })
          return
        }

        if (printerConfig.type === 'bluetooth' && !printerConfig.bluetoothAddress) {
          res.status(400).json({ error: 'Missing Bluetooth address' })
          return
        }

        savePrinterConfig(printerConfig)

        // Update printer manager with new config
        if (this.printerManager) {
          this.printerManager.setConfig(printerConfig)
        }

        logger.info(`Printer configuration saved: ${printerConfig.type}`)
        res.json({ success: true, message: 'Printer configured' })
      } catch (error) {
        logger.error('Error saving printer config', error)
        res.status(500).json({ error: 'Failed to save printer configuration' })
      }
    })

    // Test network printer connection
    this.app.post('/api/printers/network/test', async (req: Request, res: Response) => {
      if (!this.printerManager) {
        res.status(503).json({ error: 'Printer manager not available' })
        return
      }

      try {
        const { ip, port } = req.body

        if (!ip || !port) {
          res.status(400).json({ error: 'Missing IP or port' })
          return
        }

        const success = await this.printerManager.testNetworkPrinter(ip, parseInt(port))
        res.json({ success, message: success ? 'Connection successful' : 'Connection failed' })
      } catch (error) {
        logger.error('Error testing network printer', error)
        res.status(500).json({ error: 'Failed to test network connection' })
      }
    })

    // ============================================
    // Bluetooth API Endpoints
    // ============================================

    // Get paired Bluetooth devices
    this.app.get('/api/bluetooth/devices', async (_req: Request, res: Response) => {
      if (!this.printerManager) {
        res.status(503).json({ error: 'Printer manager not available' })
        return
      }

      try {
        const devices = await this.printerManager.scanBluetoothDevices()
        res.json({ devices })
      } catch (error) {
        logger.error('Error getting Bluetooth devices', error)
        res.status(500).json({ error: 'Failed to get Bluetooth devices' })
      }
    })

    // Scan for new Bluetooth devices
    this.app.get('/api/bluetooth/scan', async (_req: Request, res: Response) => {
      if (!this.printerManager) {
        res.status(503).json({ error: 'Printer manager not available' })
        return
      }

      try {
        const devices = await this.printerManager.startBluetoothScan()
        res.json({ devices })
      } catch (error) {
        logger.error('Error scanning Bluetooth', error)
        res.status(500).json({ error: 'Failed to scan Bluetooth devices' })
      }
    })

    // Pair with a Bluetooth device
    this.app.post('/api/bluetooth/pair', async (req: Request, res: Response) => {
      if (!this.printerManager) {
        res.status(503).json({ error: 'Printer manager not available' })
        return
      }

      try {
        const { address } = req.body

        if (!address) {
          res.status(400).json({ error: 'Missing Bluetooth address' })
          return
        }

        const result = await this.printerManager.pairBluetoothDevice(address)
        if (result.success) {
          res.json({ success: true, message: 'Device paired successfully' })
        } else {
          res.status(400).json({ success: false, error: result.error || 'Pairing failed' })
        }
      } catch (error) {
        logger.error('Error pairing Bluetooth device', error)
        res.status(500).json({ error: 'Failed to pair Bluetooth device' })
      }
    })

    // Test print
    this.app.post('/api/printers/test', async (_req: Request, res: Response) => {
      if (!this.printerManager) {
        res.status(503).json({ error: 'Printer manager not available' })
        return
      }

      try {
        const success = await this.printerManager.printTestPage()
        if (success) {
          res.json({ success: true, message: 'Test page printed' })
        } else {
          res.status(500).json({ error: 'Failed to print test page' })
        }
      } catch (error) {
        logger.error('Error printing test page', error)
        res.status(500).json({ error: 'Failed to print test page' })
      }
    })

    // ============================================
    // Multi-Printer API Endpoints
    // ============================================

    // Get all local printers
    this.app.get('/api/printers/local', (_req: Request, res: Response) => {
      try {
        const printers = getLocalPrinters()
        res.json({ printers })
      } catch (error) {
        logger.error('Error getting local printers', error)
        res.status(500).json({ error: 'Failed to get local printers' })
      }
    })

    // Add/Update a local printer
    this.app.post('/api/printers/local', (req: Request, res: Response) => {
      try {
        const printer: LocalPrinter = req.body

        if (!printer.name || !printer.type) {
          res.status(400).json({ error: 'Missing required fields: name, type' })
          return
        }

        // Generate id if not provided
        if (!printer.id) {
          printer.id = `printer-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
        }

        // Validate USB specific fields
        if (printer.type === 'usb' && (!printer.vendorId || !printer.productId)) {
          res.status(400).json({ error: 'USB printer requires vendorId and productId' })
          return
        }

        // Validate network specific fields
        if (printer.type === 'network' && !printer.ip) {
          res.status(400).json({ error: 'Network printer requires ip address' })
          return
        }

        addLocalPrinter(printer)

        // Update registry if available
        if (this.printerRegistry) {
          this.printerRegistry.registerPrinter(printer)
        }

        logger.info(`Local printer added/updated: ${printer.name} (${printer.id})`)
        res.json({ success: true, printer })
      } catch (error) {
        logger.error('Error adding local printer', error)
        res.status(500).json({ error: 'Failed to add local printer' })
      }
    })

    // Delete a local printer
    this.app.delete('/api/printers/local/:id', (req: Request, res: Response) => {
      try {
        const { id } = req.params

        removeLocalPrinter(id)

        // Update registry if available
        if (this.printerRegistry) {
          this.printerRegistry.unregisterPrinter(id)
        }

        logger.info(`Local printer removed: ${id}`)
        res.json({ success: true })
      } catch (error) {
        logger.error('Error removing local printer', error)
        res.status(500).json({ error: 'Failed to remove local printer' })
      }
    })

    // Get printer assignments
    this.app.get('/api/printers/assignments', (_req: Request, res: Response) => {
      try {
        const assignments = getPrinterAssignments()
        res.json({ assignments })
      } catch (error) {
        logger.error('Error getting printer assignments', error)
        res.status(500).json({ error: 'Failed to get printer assignments' })
      }
    })

    // Save printer assignments
    this.app.post('/api/printers/assignments', (req: Request, res: Response) => {
      try {
        const { assignments } = req.body as { assignments: PrinterAssignment[] }

        if (!Array.isArray(assignments)) {
          res.status(400).json({ error: 'assignments must be an array' })
          return
        }

        savePrinterAssignments(assignments)

        // Update registry if available
        if (this.printerRegistry) {
          this.printerRegistry.setAssignments(assignments)
        }

        logger.info(`Saved ${assignments.length} printer assignments`)
        res.json({ success: true, assignments })
      } catch (error) {
        logger.error('Error saving printer assignments', error)
        res.status(500).json({ error: 'Failed to save printer assignments' })
      }
    })

    // Get/Set dashboard sync setting
    this.app.get('/api/printers/sync-setting', (_req: Request, res: Response) => {
      try {
        const syncEnabled = getSyncWithDashboard()
        res.json({ syncEnabled })
      } catch (error) {
        res.status(500).json({ error: 'Failed to get sync setting' })
      }
    })

    this.app.post('/api/printers/sync-setting', (req: Request, res: Response) => {
      try {
        const { enabled } = req.body
        setSyncWithDashboard(!!enabled)
        logger.info(`Dashboard sync ${enabled ? 'enabled' : 'disabled'}`)
        res.json({ success: true, syncEnabled: !!enabled })
      } catch (error) {
        res.status(500).json({ error: 'Failed to set sync setting' })
      }
    })

    // Test a specific printer
    this.app.post('/api/printers/:id/test', async (req: Request, res: Response) => {
      const { id } = req.params

      try {
        let success = false

        if (this.printerRegistry) {
          success = await this.printerRegistry.testPrinter(id)
        } else if (this.printerManager) {
          // Legacy mode: test the main printer
          success = await this.printerManager.testConnection()
        }

        res.json({ success, message: success ? 'Printer connected' : 'Printer not available' })
      } catch (error) {
        logger.error(`Error testing printer ${id}`, error)
        res.status(500).json({ error: 'Failed to test printer' })
      }
    })

    // Print test page to specific printer
    this.app.post('/api/printers/:id/test-print', async (req: Request, res: Response) => {
      const { id } = req.params

      try {
        let success = false

        if (this.printerRegistry) {
          success = await this.printerRegistry.printTestPage(id)
        } else if (this.printerManager) {
          success = await this.printerManager.printTestPage()
        }

        res.json({ success, message: success ? 'Test page printed' : 'Print failed' })
      } catch (error) {
        logger.error(`Error printing test page to ${id}`, error)
        res.status(500).json({ error: 'Failed to print test page' })
      }
    })

    // Open cash drawer on specific printer
    this.app.post('/api/printers/:id/drawer', async (req: Request, res: Response) => {
      const { id } = req.params

      try {
        let success = false

        if (this.printerRegistry) {
          success = await this.printerRegistry.openCashDrawer(id)
        } else if (this.printerManager) {
          // Legacy mode: send cash drawer command
          const cashDrawerCommand = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])
          success = await this.printerManager.print(cashDrawerCommand)
        }

        res.json({ success, message: success ? 'Cash drawer opened' : 'Failed to open drawer' })
      } catch (error) {
        logger.error(`Error opening cash drawer on ${id}`, error)
        res.status(500).json({ error: 'Failed to open cash drawer' })
      }
    })

    // Get multi-printer status
    this.app.get('/api/printers/multi-status', (_req: Request, res: Response) => {
      try {
        const localPrinters = getLocalPrinters()
        const assignments = getPrinterAssignments()
        const syncEnabled = getSyncWithDashboard()

        let registryStatus: Record<string, unknown> | null = null
        if (this.printerRegistry) {
          const status = this.printerRegistry.getStatus()
          registryStatus = {}
          for (const [id, info] of status) {
            registryStatus[id] = {
              name: info.config.name,
              type: info.config.type,
              status: info.status,
              lastUsed: info.lastUsed?.toISOString(),
            }
          }
        }

        res.json({
          mode: this.printerRegistry ? 'multi-printer' : 'legacy',
          localPrinters,
          assignments,
          syncEnabled,
          registryStatus,
        })
      } catch (error) {
        logger.error('Error getting multi-printer status', error)
        res.status(500).json({ error: 'Failed to get multi-printer status' })
      }
    })

    // ============================================
    // Local Print API (Frontend → BitsperBox Direct)
    // ============================================

    // Device discovery endpoint
    this.app.get('/api/discovery', (_req: Request, res: Response) => {
      try {
        const config = getConfig()
        const localPrinters = getLocalPrinters()
        const assignments = getPrinterAssignments()

        // Build roles status
        const roles = {
          kitchen_default: assignments.some(a => a.role === 'kitchen_default'),
          customer_ticket: assignments.some(a => a.role === 'customer_ticket'),
          fiscal: assignments.some(a => a.role === 'fiscal'),
          stations: assignments
            .filter(a => a.role === 'station' && a.stationId)
            .map(a => a.stationId!)
        }

        // Check cash drawer capability
        const customerTicketAssignment = assignments.find(a => a.role === 'customer_ticket')
        const hasCashDrawer = customerTicketAssignment?.cashDrawerEnabled ?? false

        const response: DiscoveryResponse = {
          device_id: config?.deviceId || 'unknown',
          restaurant_id: config?.restaurantId || 'unknown',
          version: FIRMWARE_VERSION,
          mode: this.printerRegistry ? 'multi-printer' : 'legacy',
          status: 'ready',
          printers: {
            count: localPrinters.length,
            roles
          },
          capabilities: {
            cash_drawer: hasCashDrawer,
            station_routing: assignments.some(a => a.role === 'station'),
            multi_printer: !!this.printerRegistry
          }
        }

        res.json(response)
      } catch (error) {
        logger.error('Error in discovery endpoint', error)
        res.status(500).json({ error: 'Discovery failed' })
      }
    })

    // Direct print endpoint
    this.app.post('/api/print', async (req: Request, res: Response) => {
      if (!this.printService) {
        res.status(503).json({
          success: false,
          error: 'Print service not available',
          retryable: true
        })
        return
      }

      try {
        const request = req.body as LocalPrintRequest

        // Validate required fields
        if (!request.escpos_base64) {
          res.status(400).json({
            success: false,
            error: 'Missing escpos_base64 field',
            retryable: false
          })
          return
        }

        if (!request.metadata?.restaurant_id) {
          res.status(400).json({
            success: false,
            error: 'Missing metadata.restaurant_id',
            retryable: false
          })
          return
        }

        // Verify restaurant matches
        const config = getConfig()
        if (config && request.metadata.restaurant_id !== config.restaurantId) {
          res.status(403).json({
            success: false,
            error: 'Restaurant ID mismatch',
            retryable: false
          })
          return
        }

        logger.info(`[API] POST /api/print - ${request.job_type} from ${request.metadata.device_id}`)

        const result = await this.printService.printFromRequest(request)
        res.json(result)
      } catch (error) {
        logger.error('Error in print endpoint', error)
        res.status(500).json({
          success: false,
          error: 'Internal server error',
          retryable: true
        })
      }
    })

    // Station tickets batch print endpoint
    this.app.post('/api/print/station-tickets', async (req: Request, res: Response) => {
      if (!this.printService) {
        res.status(503).json({
          success: false,
          results: [],
          error: 'Print service not available'
        })
        return
      }

      try {
        const request = req.body as StationTicketsRequest

        // Validate
        if (!request.tickets || !Array.isArray(request.tickets)) {
          res.status(400).json({
            success: false,
            results: [],
            error: 'Missing or invalid tickets array'
          })
          return
        }

        if (!request.metadata?.restaurant_id) {
          res.status(400).json({
            success: false,
            results: [],
            error: 'Missing metadata.restaurant_id'
          })
          return
        }

        // Verify restaurant
        const config = getConfig()
        if (config && request.metadata.restaurant_id !== config.restaurantId) {
          res.status(403).json({
            success: false,
            results: [],
            error: 'Restaurant ID mismatch'
          })
          return
        }

        logger.info(`[API] POST /api/print/station-tickets - ${request.tickets.length} tickets for order ${request.metadata.order_id}`)

        const result = await this.printService.printStationTicketsFromRequest(request)
        res.json(result)
      } catch (error) {
        logger.error('Error in station-tickets endpoint', error)
        res.status(500).json({
          success: false,
          results: [],
          error: 'Internal server error'
        })
      }
    })

    // Open cash drawer endpoint
    this.app.post('/api/cash-drawer/open', async (req: Request, res: Response) => {
      if (!this.printService) {
        res.status(503).json({ success: false, error: 'Print service not available' })
        return
      }

      try {
        const request = req.body as CashDrawerRequest
        const role = request.role || 'customer_ticket'

        logger.info(`[API] POST /api/cash-drawer/open - role: ${role}`)

        const success = await this.printService.openCashDrawerFromRequest(role)
        res.json({
          success,
          message: success ? 'Cash drawer opened' : 'Failed to open cash drawer'
        })
      } catch (error) {
        logger.error('Error in cash-drawer endpoint', error)
        res.status(500).json({ success: false, error: 'Internal server error' })
      }
    })

    // Health check
    this.app.get('/api/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() })
    })

    // Serve index.html for all other routes (SPA support)
    // Express 5 uses different wildcard syntax
    this.app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(getPublicDir(), 'index.html'))
    })
  }

  setPrinterManager(printerManager: PrinterManager) {
    this.printerManager = printerManager
  }

  setPrinterRegistry(printerRegistry: PrinterRegistry) {
    this.printerRegistry = printerRegistry
  }

  setPrintService(printService: PrintService) {
    this.printService = printService
  }

  setStatusGetter(getStatus: () => StatusInfo) {
    this.getStatus = getStatus
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, '0.0.0.0', () => {
        logger.success(`Web UI available at http://localhost:${this.port}`)
        logger.info(`Access from network: http://<pi-ip>:${this.port}`)
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Web server stopped')
          resolve()
        })
      } else {
        resolve()
      }
    })
  }
}

export default WebServer
