import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Subtract `days` days from a YYYY-MM-DD string, return the new Date */
export function subDays(dateStr: string, days: number): Date {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - days)
  return d
}

/** Convert a Date to YYYY-MM-DD */
export function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

/** Today as YYYY-MM-DD */
export function today(): string {
  return toDateStr(new Date())
}

/** Format cost to enough decimal places to be non-zero for sub-cent values */
export function formatCost(v: number): string {
  if (v === 0) return '$0.00'
  if (v < 0.0001) return `$${v.toFixed(8)}`
  if (v < 0.01) return `$${v.toFixed(6)}`
  return `$${v.toFixed(4)}`
}

/** "Mar 16" from "2026-03-16" */
export function formatChartDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
