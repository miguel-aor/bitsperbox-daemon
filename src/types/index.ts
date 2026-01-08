// ============================================
// BitsperBox Types
// ============================================

export interface DeviceConfig {
  deviceId: string
  deviceToken: string
  restaurantId: string
  restaurantName?: string
  supabaseUrl: string
  supabaseKey: string
  frontendUrl: string // URL del frontend para APIs de tickets (ej: https://app.bitsperfoods.com)
  // Legacy single printer (backward compatibility)
  printer?: PrinterConfig
  // Multi-printer support
  localPrinters?: LocalPrinter[]
  printerAssignments?: PrinterAssignment[]
  syncWithDashboard?: boolean  // Si true, lee assignments de Supabase
}

export interface PrinterConfig {
  type: 'usb' | 'network' | 'bluetooth'
  // USB printer
  vendorId?: number
  productId?: number
  // Network printer
  ip?: string
  port?: number
  // Bluetooth printer
  bluetoothAddress?: string  // MAC address like "00:11:22:33:44:55"
  bluetoothName?: string     // Human-readable name
}

export interface BluetoothDevice {
  address: string
  name: string
  paired: boolean
  connected?: boolean
}

// ============================================
// Database Types (from Supabase)
// ============================================

export interface Order {
  id: string
  restaurant_id: string
  order_number: string
  table_number?: string
  order_type: 'dine_in' | 'takeout' | 'delivery'
  status: string
  items: OrderItem[]
  subtotal: number
  tax: number
  total: number
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  name: string
  quantity: number
  unit_price: number
  notes?: string
  modifiers?: OrderItemModifier[]
  is_addition?: boolean
  addition_group_id?: string
}

export interface OrderItemModifier {
  name: string
  price: number
}

export interface PrintJob {
  id: string
  restaurant_id: string
  order_id: string
  job_type: 'kitchen_order' | 'customer_ticket' | 'addition' | 'cash_report'
  status: 'pending' | 'claimed' | 'printing' | 'completed' | 'failed'
  escpos_data?: string
  claimed_by_device?: string
  created_at: string
  completed_at?: string
  error_message?: string
}

export interface DeviceHeartbeat {
  device_id: string
  restaurant_id: string
  status: 'online' | 'offline' | 'error'
  printer_status: 'ready' | 'error' | 'no_paper' | 'disconnected'
  last_print_at?: string
  ip_address?: string
  version: string
  uptime_seconds: number
}

// ============================================
// Realtime Payload Types
// ============================================

export interface RealtimePayload<T> {
  commit_timestamp: string
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: T
  old: T | null
  schema: string
  table: string
}

// ============================================
// Print Request Types
// ============================================

export interface PrintRequest {
  orderId: string
  type: 'kitchen' | 'customer' | 'addition'
  additionGroupId?: string
}

export interface PrintResult {
  success: boolean
  jobId?: string
  error?: string
  printedAt?: string
}

// ============================================
// API Response Types
// ============================================

export interface EscPosResponse {
  success: boolean
  data?: string // base64 encoded ESC/POS
  error?: string
}

export interface ClaimJobResponse {
  success: boolean
  jobId?: string
  alreadyClaimed?: boolean
}

// ============================================
// Multi-Printer Types
// ============================================

/**
 * Roles de impresora (deben coincidir con dashboard)
 */
export type PrinterRole =
  | 'customer_ticket'
  | 'kitchen_default'
  | 'fiscal'
  | 'station'

/**
 * Impresora física conectada al Pi
 */
export interface LocalPrinter {
  id: string                    // ID único local: "printer-1", "usb-epson"
  name: string                  // Nombre visible: "Epson TM-T20II"
  type: 'usb' | 'network' | 'bluetooth'
  // USB
  vendorId?: number
  productId?: number
  // Network
  ip?: string
  port?: number
  // Bluetooth
  bluetoothAddress?: string
  bluetoothName?: string
  // Estado
  status?: 'ready' | 'error' | 'disconnected'
  lastUsed?: string
}

/**
 * Asignación: rol del dashboard → impresora local
 */
export interface PrinterAssignment {
  role: PrinterRole
  stationId?: string            // Solo para role='station'
  stationName?: string          // Nombre de estación para UI
  localPrinterId: string        // Referencia a LocalPrinter.id
  copies?: number               // Copias por ticket
  cashDrawerEnabled?: boolean   // Solo para customer_ticket
}

/**
 * Config de impresora del dashboard (para sincronización)
 */
export interface DashboardPrinterConfig {
  printer_name: string
  print_mode: 'driver' | 'network'
  network_ip?: string
  network_port?: number
  enabled: boolean
  copies: number
  cash_drawer_enabled?: boolean
}

/**
 * PrinterSettings del dashboard
 */
export interface DashboardPrinterSettings {
  customer_ticket_printer?: DashboardPrinterConfig | null
  fiscal_receipt_printer?: DashboardPrinterConfig | null
  kitchen_default_printer?: DashboardPrinterConfig | null
}

/**
 * Estación de cocina con config de impresora
 */
export interface KitchenStationPrinter {
  stationId: string
  stationName: string
  printerConfig: DashboardPrinterConfig | null
}

/**
 * Ticket de estación (para routing)
 */
export interface StationTicket {
  stationId: string
  stationName: string
  printerConfig?: {
    printer_name: string
    copies: number
  }
  escposBase64: string
}

/**
 * Resultado de impresión multi-printer
 */
export interface MultiPrintResult {
  success: boolean
  printerId: string
  printerName: string
  error?: string
}
