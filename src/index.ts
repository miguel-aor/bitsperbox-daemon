#!/usr/bin/env node

import { logger } from './utils/logger.js'
import {
  getConfig,
  isConfigured,
  getLocalPrinters,
  getPrinterAssignments,
  getSyncWithDashboard,
  savePrinterAssignments,
  migrateToMultiPrinter,
  hasMultiPrinterConfig,
} from './utils/config.js'
import { PrinterManager } from './managers/PrinterManager.js'
import { PrinterRegistry } from './managers/PrinterRegistry.js'
import { RealtimeManager } from './managers/RealtimeManager.js'
import { PrintService } from './services/PrintService.js'
import { DashboardSync } from './services/DashboardSync.js'
import { WebServer } from './web/server.js'

const VERSION = '1.1.0' // Updated for multi-printer support
const WEB_PORT = parseInt(process.env.WEB_PORT || '3333')

async function main() {
  // Display banner
  console.log('')
  logger.box('BitsperBox Daemon v' + VERSION, [
    'Hardware bridge for BitsperFoods',
    'Raspberry Pi Print Server',
    'Multi-Printer Support',
  ])
  console.log('')

  // Initialize Printer Manager early (needed for web UI, legacy detection)
  const printerManager = new PrinterManager()

  // Start Web UI (always available for configuration)
  const webServer = new WebServer({ port: WEB_PORT, printerManager })
  await webServer.start()

  // Check configuration
  if (!isConfigured()) {
    logger.warn('BitsperBox is not configured!')
    logger.info(`Open http://localhost:${WEB_PORT} to configure`)
    logger.info('Or run: npm run setup')

    // Keep running for web configuration
    process.on('SIGINT', async () => {
      await webServer.stop()
      process.exit(0)
    })
    process.on('SIGTERM', async () => {
      await webServer.stop()
      process.exit(0)
    })
    process.stdin.resume()
    return
  }

  const config = getConfig()
  if (!config) {
    logger.error('Failed to load configuration')
    process.exit(1)
  }

  logger.info(`Restaurant: ${config.restaurantName || config.restaurantId}`)
  logger.info(`Device ID: ${config.deviceId}`)
  logger.info(`Frontend: ${config.frontendUrl}`)

  // ============================================
  // Multi-Printer Initialization
  // ============================================

  let printerRegistry: PrinterRegistry | null = null
  let useMultiPrinter = false

  // Try to migrate legacy config to multi-printer
  if (!hasMultiPrinterConfig() && config.printer) {
    logger.info('Migrating legacy printer config to multi-printer...')
    const migrated = migrateToMultiPrinter()
    if (migrated) {
      logger.success('Migration complete')
    }
  }

  // Check if we have multi-printer config
  const localPrinters = getLocalPrinters()
  if (localPrinters.length > 0) {
    useMultiPrinter = true
    logger.info(`Multi-printer mode: ${localPrinters.length} printer(s) configured`)

    // Create and populate registry
    printerRegistry = new PrinterRegistry()

    for (const printer of localPrinters) {
      printerRegistry.registerPrinter(printer)
      logger.info(`  - ${printer.name} (${printer.type})`)
    }

    // Load assignments
    let assignments = getPrinterAssignments()

    // If sync with dashboard is enabled, fetch and merge
    if (getSyncWithDashboard()) {
      logger.info('Syncing printer assignments with dashboard...')

      try {
        const dashboardSync = new DashboardSync(
          config.supabaseUrl,
          config.supabaseKey,
          config.restaurantId
        )

        const syncedAssignments = await dashboardSync.fullSync(localPrinters)

        if (syncedAssignments.length > 0) {
          // Merge: dashboard assignments take priority
          assignments = syncedAssignments
          savePrinterAssignments(assignments)
          logger.success(`Synced ${assignments.length} assignments from dashboard`)
        }
      } catch (error) {
        logger.warn('Dashboard sync failed, using local assignments')
        logger.debug(String(error))
      }
    }

    // Load assignments into registry
    printerRegistry.setAssignments(assignments)

    // Update web server with registry
    webServer.setPrinterRegistry(printerRegistry)

    // Test all printers
    logger.info('Testing printer connections...')
    const testResults = await printerRegistry.testAllPrinters()
    for (const [id, success] of testResults) {
      const printer = localPrinters.find(p => p.id === id)
      if (success) {
        logger.success(`  ✓ ${printer?.name || id}`)
      } else {
        logger.warn(`  ✗ ${printer?.name || id} - will retry on print`)
      }
    }
  } else {
    // Legacy single-printer mode
    logger.info('Single-printer mode (legacy)')

    if (config.printer) {
      printerManager.setConfig(config.printer)
    }

    // Detect printers
    const printers = await printerManager.detectPrinters()
    if (printers.length === 0) {
      logger.warn('No USB printers detected')
      logger.info('Make sure the printer is connected and powered on')
    } else {
      logger.success(`Found ${printers.length} printer(s)`)
      printers.forEach(p => {
        logger.info(`  - ${p.vendorName} (${p.devicePath || `${p.vendorId}:${p.productId}`})`)
      })
    }

    // Test printer connection
    if (config.printer) {
      const connected = await printerManager.testConnection()
      if (connected) {
        logger.success('Printer connection OK')
      } else {
        logger.warn('Printer connection failed - will retry on print')
      }
    }
  }

  // ============================================
  // Initialize Print Service
  // ============================================

  const printService = useMultiPrinter && printerRegistry
    ? new PrintService(config, printerRegistry)
    : new PrintService(config, printerManager)

  logger.info(`PrintService mode: ${printService.getStatus().mode}`)

  // ============================================
  // Initialize Realtime Manager
  // ============================================

  logger.info('Connecting to BitsperFoods cloud...')
  const realtimeManager = new RealtimeManager(config)

  // Set up callbacks for all event types
  realtimeManager.setKitchenOrderCallback(async (order, escposData) => {
    await printService.printKitchenOrder(order, escposData)
  })

  realtimeManager.setStationTicketsCallback(async (orderId, tickets) => {
    await printService.printStationTickets(orderId, tickets)
  })

  realtimeManager.setAdditionCallback(async (order, additionGroupId, escposData) => {
    await printService.printAddition(order, additionGroupId, escposData)
  })

  realtimeManager.setCustomerTicketCallback(async (ticketId, orderId, escposData) => {
    // In multi-printer mode, we could also pass payment method for cash drawer
    await printService.printCustomerTicket(ticketId, orderId, escposData)
  })

  realtimeManager.setCashReportCallback(async (reportId, reportType, escposData) => {
    await printService.printCashReport(reportId, reportType, escposData)
  })

  // Connect to Realtime
  const connected = await realtimeManager.connect()
  if (!connected) {
    logger.error('Failed to connect to cloud')
    process.exit(1)
  }

  // Set up status getter for web UI
  webServer.setStatusGetter(() => ({
    connected: realtimeManager.isConnected(),
    realtimeStatus: realtimeManager.getStatus(),
    lastOrderTime: realtimeManager.getLastOrderTime()?.toISOString(),
    ordersProcessed: realtimeManager.getOrdersProcessed(),
  }))

  logger.success('BitsperBox is running!')
  logger.info('Mode: ' + (useMultiPrinter ? 'Multi-Printer' : 'Legacy Single-Printer'))
  logger.info('Listening for:')
  logger.info('  - New orders (kitchen tickets)')
  logger.info('  - Order additions')
  logger.info('  - Customer tickets')
  logger.info('  - Cash reports (X/Z)')
  console.log('')

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log('')
    logger.info(`Received ${signal}, shutting down...`)
    await realtimeManager.disconnect()
    await webServer.stop()
    logger.info('Goodbye!')
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Keep the process alive
  process.stdin.resume()
}

main().catch(error => {
  logger.error('Fatal error', error)
  process.exit(1)
})
