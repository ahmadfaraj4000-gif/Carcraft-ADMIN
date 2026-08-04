import { jsPDF } from 'jspdf'

const PAYROLL_TIME_ZONE = 'America/New_York'
const PAGE_MARGIN = 32

const colors = {
  accent: [213, 43, 30],
  dark: [16, 17, 20],
  text: [31, 41, 51],
  muted: [104, 117, 134],
  border: [203, 211, 221],
  soft: [246, 247, 248],
  white: [255, 255, 255]
}

function dateParts(timestamp) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: PAYROLL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]))
}

function dateKey(timestamp) {
  const parts = dateParts(timestamp)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function formatPeriodDate(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PAYROLL_TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(timestamp))
}

function formatDayHeader(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PAYROLL_TIME_ZONE,
    weekday: 'short',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestamp)).toUpperCase()
}

function formatGeneratedAt(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PAYROLL_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(timestamp))
}

function formatPdfHours(milliseconds) {
  if (!milliseconds || milliseconds < 60000) return '-'
  const totalMinutes = Math.floor(milliseconds / 60000)
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`
}

function truncateText(doc, value, maxWidth) {
  const text = String(value || '')
  if (doc.getTextWidth(text) <= maxWidth) return text
  let shortened = text
  while (shortened.length > 1 && doc.getTextWidth(`${shortened}...`) > maxWidth) shortened = shortened.slice(0, -1)
  return `${shortened}...`
}

export function payrollPdfFilename(dayStarts) {
  return `car-craft-payroll-${dateKey(dayStarts[0])}-to-${dateKey(dayStarts[4])}.pdf`
}

export function buildPayrollPdf({ dayStarts, employees, dailyTotals, weeklyTotal, generatedAt = Date.now() }) {
  if (!Array.isArray(dayStarts) || dayStarts.length < 6) throw new Error('Six payroll day boundaries are required.')

  const payrollEmployees = (employees || []).filter((employee) => employee.workedMilliseconds > 0)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const periodEnd = dayStarts[5]
  const completed = periodEnd <= generatedAt

  doc.setProperties({
    title: `Car Craft Payroll ${dateKey(dayStarts[0])} to ${dateKey(dayStarts[4])}`,
    subject: 'Monday through Friday employee payroll hours',
    author: 'Car Craft Autobody'
  })

  doc.setFillColor(...colors.dark)
  doc.rect(0, 0, pageWidth, 88, 'F')
  doc.setFillColor(...colors.accent)
  doc.rect(0, 88, pageWidth, 5, 'F')
  doc.setTextColor(...colors.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('CAR CRAFT AUTOBODY', PAGE_MARGIN, 28)
  doc.setFontSize(24)
  doc.text('Weekly Payroll Hours', PAGE_MARGIN, 57)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`${formatPeriodDate(dayStarts[0])} - ${formatPeriodDate(dayStarts[4])}`, PAGE_MARGIN, 75)

  const statusWidth = 126
  doc.setFillColor(...(completed ? [21, 128, 61] : [180, 83, 9]))
  doc.roundedRect(pageWidth - PAGE_MARGIN - statusWidth, 25, statusWidth, 25, 4, 4, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(completed ? 'COMPLETED PERIOD' : 'IN PROGRESS', pageWidth - PAGE_MARGIN - statusWidth / 2, 41, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Generated ${formatGeneratedAt(generatedAt)}`, pageWidth - PAGE_MARGIN, 67, { align: 'right' })

  const tableX = PAGE_MARGIN
  const tableY = 116
  const tableWidth = pageWidth - PAGE_MARGIN * 2
  const employeeWidth = 174
  const totalWidth = 92
  const dayWidth = (tableWidth - employeeWidth - totalWidth) / 5
  const headerHeight = 36
  const footerTop = pageHeight - 42
  const bodyRows = Math.max(payrollEmployees.length, 1) + 1
  const rowHeight = Math.min(31, (footerTop - tableY - headerHeight) / bodyRows)
  const bodyFontSize = Math.max(5.5, Math.min(9.5, rowHeight * 0.36))
  const columns = [
    { label: 'EMPLOYEE', width: employeeWidth, align: 'left' },
    ...dayStarts.slice(0, 5).map((timestamp) => ({ label: formatDayHeader(timestamp), width: dayWidth, align: 'center' })),
    { label: 'WEEK TOTAL', width: totalWidth, align: 'center' }
  ]

  let x = tableX
  doc.setFillColor(...colors.dark)
  doc.setDrawColor(...colors.border)
  doc.setLineWidth(0.7)
  columns.forEach((column) => {
    doc.setFillColor(...colors.dark)
    doc.rect(x, tableY, column.width, headerHeight, 'FD')
    doc.setTextColor(...colors.white)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(column.label, column.align === 'left' ? x + 9 : x + column.width / 2, tableY + 22, { align: column.align })
    x += column.width
  })

  let y = tableY + headerHeight
  const rows = payrollEmployees.length ? payrollEmployees : [{ employeeName: 'No paid hours recorded', dailyMilliseconds: [], workedMilliseconds: 0, empty: true }]
  rows.forEach((employee, rowIndex) => {
    x = tableX
    doc.setTextColor(...(employee.empty ? colors.muted : colors.text))
    columns.forEach((column, columnIndex) => {
      doc.setFillColor(...(rowIndex % 2 ? colors.soft : colors.white))
      doc.rect(x, y, column.width, rowHeight, 'FD')
      doc.setFont('helvetica', columnIndex === 0 || columnIndex === 6 ? 'bold' : 'normal')
      doc.setFontSize(bodyFontSize)
      const value = columnIndex === 0
        ? truncateText(doc, employee.employeeName, column.width - 18)
        : columnIndex === 6
          ? formatPdfHours(employee.workedMilliseconds)
          : formatPdfHours(employee.dailyMilliseconds?.[columnIndex - 1] || 0)
      doc.text(value, columnIndex === 0 ? x + 9 : x + column.width / 2, y + rowHeight / 2 + bodyFontSize * 0.34, { align: columnIndex === 0 ? 'left' : 'center' })
      x += column.width
    })
    y += rowHeight
  })

  x = tableX
  doc.setTextColor(...colors.text)
  columns.forEach((column, columnIndex) => {
    doc.setFillColor(238, 240, 243)
    doc.rect(x, y, column.width, rowHeight, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(bodyFontSize)
    const value = columnIndex === 0
      ? 'TEAM TOTAL'
      : columnIndex === 6
        ? formatPdfHours(weeklyTotal)
        : formatPdfHours(dailyTotals?.[columnIndex - 1] || 0)
    doc.text(value, columnIndex === 0 ? x + 9 : x + column.width / 2, y + rowHeight / 2 + bodyFontSize * 0.34, { align: columnIndex === 0 ? 'left' : 'center' })
    x += column.width
  })

  doc.setTextColor(...colors.muted)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Paid hours are calculated from clock-in and clock-out records. Lunch breaks are excluded.', PAGE_MARGIN, pageHeight - 20)
  doc.text('Page 1 of 1', pageWidth - PAGE_MARGIN, pageHeight - 20, { align: 'right' })

  return doc
}

export function downloadPayrollPdf(data) {
  const doc = buildPayrollPdf(data)
  doc.save(payrollPdfFilename(data.dayStarts))
}
