import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../utils/logger.js'
import type {
  DashboardPrinterSettings,
  DashboardPrinterConfig,
  KitchenStationPrinter,
  LocalPrinter,
  PrinterAssignment,
} from '../types/index.js'

/**
 * DashboardSync - Sincroniza configuración de impresoras con el dashboard
 *
 * Lee `printer_settings` de `restaurant_profiles` y `kitchen_stations`
 * para auto-configurar las asignaciones de impresoras.
 */
export class DashboardSync {
  private supabase: SupabaseClient
  private restaurantId: string

  constructor(supabaseUrl: string, supabaseKey: string, restaurantId: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey)
    this.restaurantId = restaurantId
    logger.info('DashboardSync initialized')
  }

  /**
   * Fetch printer_settings from restaurant_profiles
   */
  async fetchPrinterSettings(): Promise<DashboardPrinterSettings | null> {
    try {
      const { data, error } = await this.supabase
        .from('restaurant_profiles')
        .select('printer_settings')
        .eq('id', this.restaurantId)
        .single()

      if (error) {
        logger.error('Error fetching printer settings', error)
        return null
      }

      logger.debug('Fetched printer settings from dashboard')
      return data?.printer_settings || null
    } catch (error) {
      logger.error('Exception fetching printer settings', error)
      return null
    }
  }

  /**
   * Fetch kitchen_stations with printer_config
   */
  async fetchStationPrinters(): Promise<KitchenStationPrinter[]> {
    try {
      const { data, error } = await this.supabase
        .from('kitchen_stations')
        .select('id, name, printer_config')
        .eq('restaurant_id', this.restaurantId)
        .eq('is_active', true)

      if (error) {
        logger.error('Error fetching kitchen stations', error)
        return []
      }

      const stations = (data || [])
        .filter((s: { printer_config?: DashboardPrinterConfig }) => s.printer_config?.enabled)
        .map((s: { id: string; name: string; printer_config: DashboardPrinterConfig }) => ({
          stationId: s.id,
          stationName: s.name,
          printerConfig: s.printer_config,
        }))

      logger.debug(`Fetched ${stations.length} kitchen stations with printers`)
      return stations
    } catch (error) {
      logger.error('Exception fetching kitchen stations', error)
      return []
    }
  }

  /**
   * Auto-match dashboard printer configs to local printers
   *
   * Matching strategy:
   * 1. Network IP match (for network printers)
   * 2. Name similarity (for USB/Bluetooth)
   */
  autoMatchPrinters(
    dashboardSettings: DashboardPrinterSettings,
    localPrinters: LocalPrinter[]
  ): PrinterAssignment[] {
    const assignments: PrinterAssignment[] = []

    if (localPrinters.length === 0) {
      logger.warn('No local printers to match against')
      return assignments
    }

    // Helper to find best matching local printer
    const findMatch = (config: DashboardPrinterConfig | null | undefined): LocalPrinter | null => {
      if (!config || !config.enabled) return null

      // Priority 1: Match by network IP
      if (config.print_mode === 'network' && config.network_ip) {
        const networkMatch = localPrinters.find(
          p => p.type === 'network' && p.ip === config.network_ip
        )
        if (networkMatch) return networkMatch
      }

      // Priority 2: Match by name (case-insensitive, partial)
      if (config.printer_name) {
        const nameMatch = localPrinters.find(p =>
          p.name.toLowerCase().includes(config.printer_name.toLowerCase()) ||
          config.printer_name.toLowerCase().includes(p.name.toLowerCase())
        )
        if (nameMatch) return nameMatch
      }

      // Priority 3: Return first available printer as fallback
      return localPrinters[0]
    }

    // Match customer_ticket_printer
    if (dashboardSettings.customer_ticket_printer) {
      const match = findMatch(dashboardSettings.customer_ticket_printer)
      if (match) {
        assignments.push({
          role: 'customer_ticket',
          localPrinterId: match.id,
          copies: dashboardSettings.customer_ticket_printer.copies || 1,
          cashDrawerEnabled: dashboardSettings.customer_ticket_printer.cash_drawer_enabled || false,
        })
        logger.debug(`Matched customer_ticket → ${match.name}`)
      }
    }

    // Match fiscal_receipt_printer
    if (dashboardSettings.fiscal_receipt_printer) {
      const match = findMatch(dashboardSettings.fiscal_receipt_printer)
      if (match) {
        assignments.push({
          role: 'fiscal',
          localPrinterId: match.id,
          copies: dashboardSettings.fiscal_receipt_printer.copies || 1,
        })
        logger.debug(`Matched fiscal → ${match.name}`)
      }
    }

    // Match kitchen_default_printer
    if (dashboardSettings.kitchen_default_printer) {
      const match = findMatch(dashboardSettings.kitchen_default_printer)
      if (match) {
        assignments.push({
          role: 'kitchen_default',
          localPrinterId: match.id,
          copies: dashboardSettings.kitchen_default_printer.copies || 1,
        })
        logger.debug(`Matched kitchen_default → ${match.name}`)
      }
    }

    return assignments
  }

  /**
   * Auto-match station printers to local printers
   */
  autoMatchStationPrinters(
    stations: KitchenStationPrinter[],
    localPrinters: LocalPrinter[]
  ): PrinterAssignment[] {
    const assignments: PrinterAssignment[] = []

    if (localPrinters.length === 0) {
      return assignments
    }

    for (const station of stations) {
      const config = station.printerConfig
      if (!config || !config.enabled) continue

      let match: LocalPrinter | null = null

      // Try network IP match
      if (config.print_mode === 'network' && config.network_ip) {
        match = localPrinters.find(p => p.type === 'network' && p.ip === config.network_ip) || null
      }

      // Try name match
      if (!match && config.printer_name) {
        match =
          localPrinters.find(
            p =>
              p.name.toLowerCase().includes(config.printer_name.toLowerCase()) ||
              config.printer_name.toLowerCase().includes(p.name.toLowerCase())
          ) || null
      }

      if (match) {
        assignments.push({
          role: 'station',
          stationId: station.stationId,
          stationName: station.stationName,
          localPrinterId: match.id,
          copies: config.copies || 1,
        })
        logger.debug(`Matched station "${station.stationName}" → ${match.name}`)
      }
    }

    return assignments
  }

  /**
   * Full sync: fetch settings and auto-match
   */
  async fullSync(localPrinters: LocalPrinter[]): Promise<PrinterAssignment[]> {
    logger.info('Starting full dashboard sync...')

    const [settings, stations] = await Promise.all([
      this.fetchPrinterSettings(),
      this.fetchStationPrinters(),
    ])

    const allAssignments: PrinterAssignment[] = []

    // Match main roles
    if (settings) {
      const roleAssignments = this.autoMatchPrinters(settings, localPrinters)
      allAssignments.push(...roleAssignments)
    }

    // Match stations
    if (stations.length > 0) {
      const stationAssignments = this.autoMatchStationPrinters(stations, localPrinters)
      allAssignments.push(...stationAssignments)
    }

    logger.success(`Dashboard sync complete: ${allAssignments.length} assignments`)
    return allAssignments
  }

  /**
   * Subscribe to realtime changes (optional)
   */
  subscribeToChanges(
    onSettingsChange: (settings: DashboardPrinterSettings) => void,
    onStationsChange: (stations: KitchenStationPrinter[]) => void
  ): () => void {
    logger.info('Subscribing to dashboard printer changes...')

    // Subscribe to printer_settings changes
    const settingsChannel = this.supabase
      .channel('printer-settings-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'restaurant_profiles',
          filter: `id=eq.${this.restaurantId}`,
        },
        async payload => {
          logger.info('Printer settings changed in dashboard')
          const settings = await this.fetchPrinterSettings()
          if (settings) {
            onSettingsChange(settings)
          }
        }
      )
      .subscribe()

    // Subscribe to kitchen_stations changes
    const stationsChannel = this.supabase
      .channel('kitchen-stations-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'kitchen_stations',
          filter: `restaurant_id=eq.${this.restaurantId}`,
        },
        async () => {
          logger.info('Kitchen stations changed in dashboard')
          const stations = await this.fetchStationPrinters()
          onStationsChange(stations)
        }
      )
      .subscribe()

    // Return unsubscribe function
    return () => {
      settingsChannel.unsubscribe()
      stationsChannel.unsubscribe()
      logger.info('Unsubscribed from dashboard changes')
    }
  }
}

export default DashboardSync
