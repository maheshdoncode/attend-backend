import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/**
 * Categorizes and aggregates deductions from granular deduction breakdown array
 */
function categorizeDeductions(deductions = [], totalDeduction = 0, advanceDeduction = 0) {
  let absentDeduction = 0;
  let lateDeduction = 0;
  let halfDayDeduction = 0;
  let advanceAmount = Number(advanceDeduction || 0);
  let otherDeduction = 0;

  const validDeductions = Array.isArray(deductions) ? deductions : [];

  validDeductions.forEach((d) => {
    const rawReason = String(d.reason || d.description || '').toLowerCase();
    const amount = Number(d.amount || 0);

    if (rawReason.includes('absent')) {
      absentDeduction += amount;
    } else if (rawReason.includes('late')) {
      lateDeduction += amount;
    } else if (rawReason.includes('half') || rawReason.includes('half day')) {
      halfDayDeduction += amount;
    } else if (rawReason.includes('advance')) {
      advanceAmount += amount;
    } else {
      otherDeduction += amount;
    }
  });

  // If breakdown was empty but total deduction exists
  const calculatedSum = absentDeduction + lateDeduction + halfDayDeduction + advanceAmount + otherDeduction;
  if (calculatedSum === 0 && totalDeduction > 0) {
    otherDeduction = Number(totalDeduction);
  }

  // Generate concise categorized string
  const parts = [];
  if (absentDeduction > 0) parts.push(`Absent: Rs. ${absentDeduction.toFixed(2)}`);
  if (lateDeduction > 0) parts.push(`Late: Rs. ${lateDeduction.toFixed(2)}`);
  if (halfDayDeduction > 0) parts.push(`Half Day: Rs. ${halfDayDeduction.toFixed(2)}`);
  if (advanceAmount > 0) parts.push(`Advance: Rs. ${advanceAmount.toFixed(2)}`);
  if (otherDeduction > 0) parts.push(`Other: Rs. ${otherDeduction.toFixed(2)}`);

  const summaryText = parts.length > 0 ? parts.join(' | ') : 'None';

  return {
    absentDeduction,
    lateDeduction,
    halfDayDeduction,
    advanceDeduction: advanceAmount,
    otherDeduction,
    summaryText,
    items: validDeductions,
  };
}

/**
 * Generates an Excel workbook buffer for monthly employee attendance.
 */
export const generateAttendanceExcel = async (employees, month, year) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(`Attendance_${month}_${year}`);

  const daysInMonth = new Date(year, month, 0).getDate();

  // Define Columns
  const columns = [
    { header: 'Employee Name', key: 'name', width: 25 },
    { header: 'Employee Code', key: 'code', width: 15 },
    { header: 'Department', key: 'department', width: 20 },
  ];

  for (let d = 1; d <= daysInMonth; d++) {
    columns.push({ header: `${d}`, key: `day_${d}`, width: 6 });
  }

  worksheet.columns = columns;

  // Header styling
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };
  worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 28;

  // Status symbols mapping
  const statusSymbols = {
    present: 'P',
    absent: 'A',
    late: 'L',
    holiday: 'H',
    half_day: 'HD',
    half_day_late: 'HD/L',
  };

  // Add Employee Rows
  employees.forEach((emp) => {
    const rowData = {
      name: emp.name,
      code: emp.employee_code || '-',
      department: emp.department || '-',
    };

    for (let d = 1; d <= daysInMonth; d++) {
      rowData[`day_${d}`] = '-';
    }

    if (Array.isArray(emp.days)) {
      emp.days.forEach((dayRecord) => {
        const dateObj = new Date(dayRecord.date);
        const dayNum = dateObj.getDate();
        const symbol = statusSymbols[dayRecord.status] || dayRecord.status || '-';
        rowData[`day_${dayNum}`] = symbol;
      });
    }

    const row = worksheet.addRow(rowData);

    // Center align status days
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = row.getCell(`day_${d}`);
      cell.alignment = { horizontal: 'center' };
      if (cell.value === 'P') cell.font = { color: { argb: 'FF059669' }, bold: true };
      else if (cell.value === 'A') cell.font = { color: { argb: 'FFDC2626' }, bold: true };
      else if (cell.value === 'L') cell.font = { color: { argb: 'FFD97706' }, bold: true };
      else if (cell.value === 'HD') cell.font = { color: { argb: 'FFF97316' }, bold: true };
      else if (cell.value === 'HD/L') cell.font = { color: { argb: 'FFEA580C' }, bold: true };
      else if (cell.value === 'H' || cell.value === 'OFF') cell.font = { color: { argb: 'FF2563EB' }, bold: true };
    }
  });

  return await workbook.xlsx.writeBuffer();
};

/**
 * Generates an Excel workbook buffer with full detailed payroll breakdown and itemized details.
 * @param {Array} payrollRecords
 * @param {number} month
 * @param {number} year
 * @returns {Promise<Buffer>}
 */
export const generatePayrollExcel = async (payrollRecords, month, year) => {
  const workbook = new ExcelJS.Workbook();

  // -------------------------------------------------------------
  // WORKSHEET 1: Payroll Summary & Category Breakdown
  // -------------------------------------------------------------
  const summarySheet = workbook.addWorksheet(`Payroll Summary`);

  summarySheet.columns = [
    { header: 'Employee Name', key: 'name', width: 22 },
    { header: 'Employee Code', key: 'code', width: 15 },
    { header: 'Department', key: 'department', width: 16 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Working Days', key: 'working_days', width: 14 },
    { header: 'Present Days', key: 'present_days', width: 14 },
    { header: 'Absent Days', key: 'absent_days', width: 14 },
    { header: 'Half Days', key: 'half_day_count', width: 12 },
    { header: 'Late Count', key: 'late_count', width: 12 },
    { header: 'Gross Salary (Rs.)', key: 'gross', width: 18 },
    { header: 'Absent Deductions (Rs.)', key: 'absent_ded', width: 22 },
    { header: 'Late Deductions (Rs.)', key: 'late_ded', width: 20 },
    { header: 'Half Day Deductions (Rs.)', key: 'half_day_ded', width: 22 },
    { header: 'Advance Repayment (Rs.)', key: 'advance_ded', width: 22 },
    { header: 'Other Deductions (Rs.)', key: 'other_ded', width: 20 },
    { header: 'Total Deductions (Rs.)', key: 'total_ded', width: 20 },
    { header: 'Net Payable (Rs.)', key: 'net', width: 18 },
    { header: 'Categorized Summary', key: 'summary', width: 45 },
  ];

  // Header Styling
  const headerRow = summarySheet.getRow(1);
  headerRow.height = 30;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  let totalGross = 0;
  let totalAbsentDed = 0;
  let totalLateDed = 0;
  let totalHalfDayDed = 0;
  let totalAdvanceDed = 0;
  let totalOtherDed = 0;
  let totalDeductions = 0;
  let totalNet = 0;

  payrollRecords.forEach((record, index) => {
    const gross = Number(record.gross_salary || 0);
    const totalDed = Number(record.total_deduction_amount || 0);
    const net = Number(record.net_salary || 0);

    const cat = categorizeDeductions(record.deduction_breakdown, totalDed, record.advance_deduction);

    totalGross += gross;
    totalAbsentDed += cat.absentDeduction;
    totalLateDed += cat.lateDeduction;
    totalHalfDayDed += cat.halfDayDeduction;
    totalAdvanceDed += cat.advanceDeduction;
    totalOtherDed += cat.otherDeduction;
    totalDeductions += totalDed;
    totalNet += net;

    const row = summarySheet.addRow({
      name: record.name || 'Unknown',
      code: record.employee_code || '-',
      department: record.department || 'General',
      status: (record.status || 'draft').toUpperCase(),
      working_days: record.working_days ?? 26,
      present_days: record.present_days ?? 0,
      absent_days: record.absent_days ?? 0,
      half_day_count: record.half_day_count ?? 0,
      late_count: record.late_count ?? 0,
      gross,
      absent_ded: cat.absentDeduction,
      late_ded: cat.lateDeduction,
      half_day_ded: cat.halfDayDeduction,
      advance_ded: cat.advanceDeduction,
      other_ded: cat.otherDeduction,
      total_ded: totalDed,
      net,
      summary: cat.summaryText,
    });

    if (index % 2 === 1) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8FAFC' },
      };
    }

    row.getCell('name').alignment = { vertical: 'middle', horizontal: 'left' };
    row.getCell('code').alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('department').alignment = { vertical: 'middle', horizontal: 'left' };
    row.getCell('status').alignment = { vertical: 'middle', horizontal: 'center' };

    ['working_days', 'present_days', 'absent_days', 'half_day_count', 'late_count'].forEach((k) => {
      row.getCell(k).alignment = { vertical: 'middle', horizontal: 'center' };
    });

    ['gross', 'absent_ded', 'late_ded', 'half_day_ded', 'advance_ded', 'other_ded', 'total_ded', 'net'].forEach((k) => {
      row.getCell(k).numFmt = '#,##0.00';
      row.getCell(k).alignment = { vertical: 'middle', horizontal: 'right' };
    });

    row.getCell('total_ded').font = { color: { argb: 'FFDC2626' }, bold: true };
    row.getCell('net').font = { color: { argb: 'FF047857' }, bold: true };
    row.getCell('summary').alignment = { vertical: 'middle', horizontal: 'left' };
  });

  // Total Summary Row
  const totalRow = summarySheet.addRow({
    name: 'TOTAL',
    code: '',
    department: '',
    status: '',
    working_days: '',
    present_days: '',
    absent_days: '',
    half_day_count: '',
    late_count: '',
    gross: totalGross,
    absent_ded: totalAbsentDed,
    late_ded: totalLateDed,
    half_day_ded: totalHalfDayDed,
    advance_ded: totalAdvanceDed,
    other_ded: totalOtherDed,
    total_ded: totalDeductions,
    net: totalNet,
    summary: `Total Employees: ${payrollRecords.length}`,
  });

  totalRow.height = 26;
  totalRow.font = { bold: true, size: 10 };
  totalRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };
  ['gross', 'absent_ded', 'late_ded', 'half_day_ded', 'advance_ded', 'other_ded', 'total_ded', 'net'].forEach((k) => {
    totalRow.getCell(k).numFmt = '#,##0.00';
    totalRow.getCell(k).alignment = { vertical: 'middle', horizontal: 'right' };
  });
  totalRow.getCell('net').font = { bold: true, color: { argb: 'FF047857' } };

  // -------------------------------------------------------------
  // WORKSHEET 2: Itemized Deduction Line-by-Line Breakdown
  // -------------------------------------------------------------
  const detailSheet = workbook.addWorksheet(`Itemized Deductions`);

  detailSheet.columns = [
    { header: 'Employee Name', key: 'name', width: 22 },
    { header: 'Employee Code', key: 'code', width: 15 },
    { header: 'Department', key: 'department', width: 16 },
    { header: 'Deduction Reason / Description', key: 'reason', width: 45 },
    { header: 'Amount (Rs.)', key: 'amount', width: 18 },
  ];

  const detailHeader = detailSheet.getRow(1);
  detailHeader.height = 28;
  detailHeader.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  detailHeader.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' },
  };
  detailHeader.alignment = { vertical: 'middle', horizontal: 'center' };

  let itemizedRowIndex = 0;
  let grandItemizedTotal = 0;

  payrollRecords.forEach((record) => {
    const rawBreakdown = Array.isArray(record.deduction_breakdown) ? record.deduction_breakdown : [];

    if (rawBreakdown.length === 0) {
      if (Number(record.total_deduction_amount || 0) > 0) {
        grandItemizedTotal += Number(record.total_deduction_amount);
        const r = detailSheet.addRow({
          name: record.name,
          code: record.employee_code || '-',
          department: record.department || 'General',
          reason: 'Manual or unitemized deduction',
          amount: Number(record.total_deduction_amount),
        });
        r.getCell('amount').numFmt = '#,##0.00';
        r.getCell('amount').alignment = { vertical: 'middle', horizontal: 'right' };
        itemizedRowIndex++;
      }
      return;
    }

    rawBreakdown.forEach((item) => {
      const amt = Number(item.amount || 0);
      grandItemizedTotal += amt;
      const r = detailSheet.addRow({
        name: record.name,
        code: record.employee_code || '-',
        department: record.department || 'General',
        reason: item.reason || item.description || 'Deduction',
        amount: amt,
      });

      if (itemizedRowIndex % 2 === 1) {
        r.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' },
        };
      }

      r.getCell('name').alignment = { vertical: 'middle', horizontal: 'left' };
      r.getCell('code').alignment = { vertical: 'middle', horizontal: 'center' };
      r.getCell('department').alignment = { vertical: 'middle', horizontal: 'left' };
      r.getCell('reason').alignment = { vertical: 'middle', horizontal: 'left' };
      r.getCell('amount').numFmt = '#,##0.00';
      r.getCell('amount').alignment = { vertical: 'middle', horizontal: 'right' };
      r.getCell('amount').font = { color: { argb: 'FFDC2626' } };
      itemizedRowIndex++;
    });
  });

  const itemizedTotalRow = detailSheet.addRow({
    name: 'TOTAL DEDUCTIONS',
    code: '',
    department: '',
    reason: `Total Line Items: ${itemizedRowIndex}`,
    amount: grandItemizedTotal,
  });
  itemizedTotalRow.height = 24;
  itemizedTotalRow.font = { bold: true };
  itemizedTotalRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };
  itemizedTotalRow.getCell('amount').numFmt = '#,##0.00';
  itemizedTotalRow.getCell('amount').alignment = { vertical: 'middle', horizontal: 'right' };
  itemizedTotalRow.getCell('amount').font = { color: { argb: 'FFDC2626' }, bold: true };

  return await workbook.xlsx.writeBuffer();
};

/**
 * Generates a clean, professional PDF buffer containing the monthly payroll summary report
 * along with detailed itemized employee deduction breakdown cards.
 * @param {Array} payrollRecords
 * @param {number} month
 * @param {number} year
 * @returns {Promise<Buffer>}
 */
export const generatePayrollPDF = (payrollRecords, month, year) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 35,
        size: 'A4',
        info: {
          Title: `Attendy HRM - Payroll Report ${month}/${year}`,
          Author: 'Attendy HRM System',
        },
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const monthName = new Date(year, month - 1, 1).toLocaleString('default', { month: 'long' });
      const totalWidth = 525;
      const startX = 35;

      // Header Banner
      const drawHeader = () => {
        doc.rect(35, 35, totalWidth, 54).fill('#0F172A');
        doc.fillColor('#FFFFFF').fontSize(15).font('Helvetica-Bold')
          .text('ATTENDY HRM SYSTEM', 48, 45, { align: 'left' });
        doc.fontSize(9).font('Helvetica')
          .fillColor('#94A3B8')
          .text('Monthly Comprehensive Payroll & Itemized Deductions Report', 48, 64);

        doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
          .text(`${monthName.toUpperCase()} ${year}`, 360, 45, { width: 185, align: 'right' });
        doc.fontSize(7.5).font('Helvetica')
          .fillColor('#94A3B8')
          .text(`Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 360, 64, { width: 185, align: 'right' });
      };

      drawHeader();

      // =========================================================
      // 1. EXECUTIVE SUMMARY TABLE
      // =========================================================
      let startY = 100;
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10)
        .text('1. Executive Payroll Summary', startX, startY);
      startY += 16;

      // Columns: Employee (125), Dept (75), Days P/A/HD/L (85), Gross (75), Deductions (80), Net (85)
      const colWidths = [120, 70, 85, 80, 80, 90];
      const headers = ['EMPLOYEE', 'DEPARTMENT', 'ATTENDANCE', 'GROSS (Rs.)', 'DEDUCTIONS', 'NET PAYABLE'];

      const drawTableHeader = (y) => {
        doc.rect(startX, y, totalWidth, 20).fill('#1E293B');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5);

        let curX = startX + 5;
        headers.forEach((h, idx) => {
          const align = (idx === 3 || idx === 4 || idx === 5) ? 'right' : (idx === 2 ? 'center' : 'left');
          doc.text(h, curX, y + 6, { width: colWidths[idx] - 8, align });
          curX += colWidths[idx];
        });
      };

      drawTableHeader(startY);
      startY += 20;

      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;

      payrollRecords.forEach((record, index) => {
        const gross = Number(record.gross_salary || 0);
        const deductions = Number(record.total_deduction_amount || 0);
        const net = Number(record.net_salary || 0);

        totalGross += gross;
        totalDeductions += deductions;
        totalNet += net;

        const rowHeight = 22;

        if (startY + rowHeight > 750) {
          doc.addPage();
          startY = 40;
          drawTableHeader(startY);
          startY += 20;
        }

        if (index % 2 === 1) {
          doc.rect(startX, startY, totalWidth, rowHeight).fill('#F8FAFC');
        } else {
          doc.rect(startX, startY, totalWidth, rowHeight).fill('#FFFFFF');
        }
        doc.rect(startX, startY + rowHeight - 0.5, totalWidth, 0.5).fill('#E2E8F0');

        let curX = startX + 5;

        // Employee
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8)
          .text(record.name || 'Unknown', curX, startY + 4, { width: colWidths[0] - 8, ellipsis: true });
        doc.fillColor('#64748B').font('Helvetica').fontSize(6.5)
          .text(record.employee_code || '-', curX, startY + 13, { width: colWidths[0] - 8 });
        curX += colWidths[0];

        // Dept
        doc.fillColor('#334155').font('Helvetica').fontSize(7.5)
          .text(record.department || 'General', curX, startY + 7, { width: colWidths[1] - 8, ellipsis: true });
        curX += colWidths[1];

        // Attendance Stats (P / A / HD / L)
        const pDays = record.present_days ?? 0;
        const aDays = record.absent_days ?? 0;
        const hdDays = record.half_day_count ?? 0;
        const lDays = record.late_count ?? 0;
        doc.fillColor('#0F172A').font('Helvetica').fontSize(7)
          .text(`P:${pDays} | A:${aDays} | HD:${hdDays} | L:${lDays}`, curX, startY + 7, {
            width: colWidths[2] - 8,
            align: 'center',
          });
        curX += colWidths[2];

        // Gross
        doc.fillColor('#0F172A').font('Helvetica').fontSize(8)
          .text(`Rs. ${gross.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, curX, startY + 7, {
            width: colWidths[3] - 8,
            align: 'right',
          });
        curX += colWidths[3];

        // Deductions
        doc.fillColor('#DC2626').font('Helvetica-Bold').fontSize(8)
          .text(`-Rs. ${deductions.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, curX, startY + 7, {
            width: colWidths[4] - 8,
            align: 'right',
          });
        curX += colWidths[4];

        // Net
        doc.fillColor('#047857').font('Helvetica-Bold').fontSize(8)
          .text(`Rs. ${net.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, curX, startY + 7, {
            width: colWidths[5] - 8,
            align: 'right',
          });

        startY += rowHeight;
      });

      // Total Row for Summary
      doc.rect(startX, startY, totalWidth, 22).fill('#E2E8F0');
      let curX = startX + 5;
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8)
        .text('TOTAL', curX, startY + 7, { width: colWidths[0] + colWidths[1] + colWidths[2] - 8 });
      curX += colWidths[0] + colWidths[1] + colWidths[2];

      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8)
        .text(`Rs. ${totalGross.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, curX, startY + 7, {
          width: colWidths[3] - 8,
          align: 'right',
        });
      curX += colWidths[3];

      doc.fillColor('#DC2626').font('Helvetica-Bold').fontSize(8)
        .text(`-Rs. ${totalDeductions.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, curX, startY + 7, {
          width: colWidths[4] - 8,
          align: 'right',
        });
      curX += colWidths[4];

      doc.fillColor('#047857').font('Helvetica-Bold').fontSize(8.5)
        .text(`Rs. ${totalNet.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, curX, startY + 7, {
          width: colWidths[5] - 8,
          align: 'right',
        });

      startY += 34;

      // =========================================================
      // 2. ITEMIZED EMPLOYEE DEDUCTION CARDS
      // =========================================================
      if (startY > 680) {
        doc.addPage();
        startY = 40;
      }

      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10)
        .text('2. Itemized Deductions & Breakdown by Employee', startX, startY);
      startY += 16;

      payrollRecords.forEach((record) => {
        const rawItems = Array.isArray(record.deduction_breakdown) ? record.deduction_breakdown : [];
        const gross = Number(record.gross_salary || 0);
        const totalDed = Number(record.total_deduction_amount || 0);
        const net = Number(record.net_salary || 0);

        // Estimate card height: header (26) + stats (16) + item rows (rawItems.length * 14 + 10)
        const itemsCount = rawItems.length > 0 ? rawItems.length : 1;
        const cardHeight = 44 + (itemsCount * 13) + 12;

        if (startY + cardHeight > 750) {
          doc.addPage();
          startY = 40;
        }

        // Card Container
        doc.rect(startX, startY, totalWidth, cardHeight).fill('#FFFFFF');
        doc.rect(startX, startY, totalWidth, cardHeight).lineWidth(0.75).stroke('#CBD5E1');

        // Card Top Banner
        doc.rect(startX, startY, totalWidth, 22).fill('#F1F5F9');
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5)
          .text(`${record.name || 'Unknown'} (${record.employee_code || 'EMP'}) · ${record.department || 'General'}`, startX + 8, startY + 6);

        doc.fillColor('#047857').font('Helvetica-Bold').fontSize(8.5)
          .text(`Net Pay: Rs. ${net.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, startX, startY + 6, {
            width: totalWidth - 8,
            align: 'right',
          });

        // Sub Stats Bar
        const statY = startY + 26;
        doc.fillColor('#475569').font('Helvetica').fontSize(7.5)
          .text(
            `Working: ${record.working_days ?? 26}d  |  Present: ${record.present_days ?? 0}d  |  Absent: ${record.absent_days ?? 0}d  |  Half Days: ${record.half_day_count ?? 0}d  |  Late: ${record.late_count ?? 0}x`,
            startX + 8,
            statY
          );

        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(7.5)
          .text(
            `Gross: Rs. ${gross.toFixed(2)}  |  Deductions: -Rs. ${totalDed.toFixed(2)}`,
            startX,
            statY,
            { width: totalWidth - 8, align: 'right' }
          );

        // Divider
        doc.rect(startX + 8, statY + 12, totalWidth - 16, 0.5).fill('#E2E8F0');

        // Itemized Lines
        let itemY = statY + 16;
        if (rawItems.length === 0) {
          doc.fillColor('#64748B').font('Helvetica-Oblique').fontSize(7.5)
            .text(
              totalDed > 0 ? `• Deduction: -Rs. ${totalDed.toFixed(2)}` : '• Full attendance recorded. No policy deductions applied.',
              startX + 12,
              itemY
            );
          itemY += 13;
        } else {
          rawItems.forEach((it) => {
            const reason = it.reason || it.description || 'Deduction';
            const amt = Number(it.amount || 0);

            doc.fillColor('#334155').font('Helvetica').fontSize(7.5)
              .text(`• ${reason}`, startX + 12, itemY, { width: totalWidth - 120, ellipsis: true });

            doc.fillColor('#DC2626').font('Helvetica-Bold').fontSize(7.5)
              .text(`-Rs. ${amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, startX, itemY, {
                width: totalWidth - 12,
                align: 'right',
              });

            itemY += 13;
          });
        }

        startY += cardHeight + 8;
      });

      // Footer
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(7)
        .text('Attendy HRM System • Confidential Payroll Document • Generated for Official Audit Use', 35, 790, {
          width: totalWidth,
          align: 'center',
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

export default {
  generateAttendanceExcel,
  generatePayrollExcel,
  generatePayrollPDF,
};
