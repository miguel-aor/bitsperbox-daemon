#!/usr/bin/env node

import { logger } from './utils/logger.js'
import { getConfig, isConfigured } from './utils/config.js'
import { PrinterManager } from './managers/PrinterManager.js'
import { RealtimeManager } from './managers/RealtimeManager.js'
import { PrintService } from './services/PrintService.js'
import { WebServer } from './web/server.js'

const VERSION = '1.0.0'
const WEB_PORT = parseInt(process.env.WEB_PORT || '3333')

async function main() {
  // Display banner
  console.log('')
  logger.box('BitsperBox Daemon v' + VERSION, [
    'Hardware bridge for BitsperFoods',
    'Raspberry Pi Print Server',
  ])
  console.log('')

  // Initialize Printer Manager early (needed for web UI)
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

  // Configure Printer Manager with saved config
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

  // Initialize Print Service
  const printService = new PrintService(config, printerManager)

  // Initialize Realtime Manager
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
