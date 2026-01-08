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
  printer?: PrinterConfig
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
