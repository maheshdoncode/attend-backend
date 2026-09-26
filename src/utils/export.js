import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/**
 * Summarizes granular deduction breakdowns into a clean, human-readable string
 * e.g., "Absent (24x): Rs. 61,400.00 | Late (3x): Rs. 1,000.00 | Half Day (2x): Rs. 3,200.00"
 */
function summarizeDeductions(deductionBreakdown, totalDeduction) {
  if (!Array.isArray(deductionBreakdown) || deductionBreakdown.length === 0) {
    return totalDeduction > 0 ? `Total: Rs. ${Number(totalDeduction).toFixed(2)}` : 'None';
  }

  const groups = {};
  deductionBreakdown.forEach((item) => {
    const rawReason = String(item.reason || item.description || 'Deduction').trim();
    let category = 'Other';
    if (/absent/i.test(rawReason)) category = 'Absent';
    else if (/late/i.test(rawReason)) category = 'Late';
    else if (/half\s*day/i.test(rawReason)) category = 'Half Day';
    else if (/advance/i.test(rawReason)) category = 'Advance';
    else if (/manual/i.test(rawReason)) category = 'Manual';
    else category = rawReason.split('(')[0].trim() || 'Other';

    if (!groups[category]) groups[category] = { count: 0, amount: 0 };
    groups[category].count += 1;
    groups[category].amount += Number(item.amount || 0);
  });

  const parts = Object.entries(groups).map(([cat, info]) => {
    if (info.count > 1) {
      return `${cat} (${info.count}x): Rs. ${info.amount.toFixed(2)}`;
    }
    return `${cat}: Rs. ${info.amount.toFixed(2)}`;
  });

  return parts.join(' | ');
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
      else if (cell.value === 'HD') cell.font = { color: { argb: 'FF7C3AED' }, bold: true };
      else if (cell.value === 'H' || cell.value === 'OFF') cell.font = { color: { argb: 'FF2563EB' }, bold: true };
    }
  });

  return await workbook.xlsx.writeBuffer();
};

/**
 * Generates an Excel workbook buffer for monthly payroll summary.
 * @param {Array} payrollRecords
 * @param {number} month
 * @param {number} year
 * @returns {Promise<Buffer>}
 */
export const generatePayrollExcel = async (payrollRecords, month, year) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(`Payroll_${month}_${year}`);

  worksheet.columns = [
    { header: 'Employee Name', key: 'name', width: 24 },
    { header: 'Employee Code', key: 'code', width: 16 },
    { header: 'Department', key: 'department', width: 18 },
    { header: 'Gross Salary (Rs.)', key: 'gross', width: 18 },
    { header: 'Total Deductions (Rs.)', key: 'deductions', width: 20 },
    { header: 'Net Payable (Rs.)', key: 'net', width: 18 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Deduction Breakdown Summary', key: 'breakdown', width: 45 },
  ];

  // Header Styling
  const headerRow = worksheet.getRow(1);
  headerRow.height = 28;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

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

    const breakdownSummary = summarizeDeductions(record.deduction_breakdown, deductions);
    const statusText = (record.status || 'draft').toUpperCase();

    const row = worksheet.addRow({
      name: record.name || 'Unknown',
      code: record.employee_code || '-',
      department: record.department || '-',
      gross,
      deductions,
      net,
      status: statusText,
      breakdown: breakdownSummary,
    });

    // Alternate background
    if (index % 2 === 1) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8FAFC' },
      };
    }

    // Alignment and numbers
    row.getCell('name').alignment = { vertical: 'middle', horizontal: 'left' };
    row.getCell('code').alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('department').alignment = { vertical: 'middle', horizontal: 'left' };
    row.getCell('gross').numFmt = '#,##0.00';
    row.getCell('gross').alignment = { vertical: 'middle', horizontal: 'right' };
    row.getCell('deductions').numFmt = '#,##0.00';
    row.getCell('deductions').alignment = { vertical: 'middle', horizontal: 'right' };
    row.getCell('net').numFmt = '#,##0.00';
    row.getCell('net').alignment = { vertical: 'middle', horizontal: 'right' };
    row.getCell('net').font = { bold: true, color: { argb: 'FF047857' } };
    row.getCell('status').alignment = { vertical: 'middle', horizontal: 'center' };
    row.getCell('breakdown').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });

  // Summary Total Row
  const totalRow = worksheet.addRow({
    name: 'TOTAL',
    code: '',
    department: '',
    gross: totalGross,
    deductions: totalDeductions,
    net: totalNet,
    status: '',
    breakdown: `Total Employees: ${payrollRecords.length}`,
  });

  totalRow.height = 24;
  totalRow.font = { bold: true, size: 11 };
  totalRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };
  totalRow.getCell('gross').numFmt = '#,##0.00';
  totalRow.getCell('deductions').numFmt = '#,##0.00';
  totalRow.getCell('net').numFmt = '#,##0.00';
  totalRow.getCell('net').font = { bold: true, color: { argb: 'FF047857' } };

  return await workbook.xlsx.writeBuffer();
};

/**
 * Generates a clean, professional PDF buffer containing the monthly payroll summary report.
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

      // --- Header Branding ---
      doc.rect(35, 35, 525, 60).fill('#0F172A');

      doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold')
        .text('ATTENDY HRM SYSTEM', 50, 48, { align: 'left' });
      doc.fontSize(10).font('Helvetica')
        .fillColor('#94A3B8')
        .text('Monthly Executive Payroll & Payout Statement', 50, 68);

      doc.fillColor('#FFFFFF').fontSize(12).font('Helvetica-Bold')
        .text(`${monthName.toUpperCase()} ${year}`, 360, 48, { width: 185, align: 'right' });
      doc.fontSize(8).font('Helvetica')
        .fillColor('#94A3B8')
        .text(`Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, 360, 68, { width: 185, align: 'right' });

      // Table Coordinates & Dimensions
      const startX = 35;
      let startY = 110;
      const totalWidth = 525;
      // Columns: Employee (125), Department (75), Gross (75), Deductions (95), Net (85), Status (70)
      const colWidths = [125, 75, 75, 95, 85, 70];
      const headers = ['EMPLOYEE', 'DEPARTMENT', 'GROSS (Rs.)', 'DEDUCTIONS', 'NET PAYABLE', 'STATUS'];

      const drawTableHeader = (y) => {
        doc.rect(startX, y, totalWidth, 22).fill('#1E293B');
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);

        let curX = startX + 6;
        headers.forEach((h, idx) => {
          const align = (idx === 2 || idx === 4) ? 'right' : (idx === 5 ? 'center' : 'left');
          doc.text(h, curX, y + 7, { width: colWidths[idx] - 10, align });
          curX += colWidths[idx];
        });
      };

      drawTableHeader(startY);
      startY += 22;

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

        const breakdownSummary = summarizeDeductions(record.deduction_breakdown, deductions);
        const statusText = (record.status || 'draft').toUpperCase();

        const rowHeight = 32;

        // Check page overflow
        if (startY + rowHeight > 750) {
          doc.addPage();
          startY = 40;
          drawTableHeader(startY);
          startY += 22;
        }

        // Row background
        if (index % 2 === 1) {
          doc.rect(startX, startY, totalWidth, rowHeight).fill('#F8FAFC');
        } else {
          doc.rect(startX, startY, totalWidth, rowHeight).fill('#FFFFFF');
        }

        // Row border bottom
        doc.rect(startX, startY + rowHeight - 0.5, totalWidth, 0.5).fill('#E2E8F0');

        let curX = startX + 6;

        // 1. Employee Name & Code
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5)
          .text(record.name || 'Unknown', curX, startY + 6, { width: colWidths[0] - 10, ellipsis: true });
        doc.fillColor('#64748B').font('Helvetica').fontSize(7.5)
          .text(record.employee_code || 'EMP-N/A', curX, startY + 18, { width: colWidths[0] - 10 });
        curX += colWidths[0];

        // 2. Department
        doc.fillColor('#334155').font('Helvetica').fontSize(8)
          .text(record.department || 'General', curX, startY + 11, { width: colWidths[1] - 10, ellipsis: true });
        curX += colWidths[1];

        // 3. Gross Salary
        doc.fillColor('#0F172A').font('Helvetica').fontSize(8.5)
          .text(`Rs. ${gross.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, curX, startY + 11, {
            width: colWidths[2] - 10,
            align: 'right',
          });
        curX += colWidths[2];

        // 4. Deductions (Total + Summary)
        doc.fillColor('#DC2626').font('Helvetica-Bold').fontSize(8)
          .text(`-Rs. ${deductions.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, curX, startY + 6, {
            width: colWidths[3] - 10,
            align: 'left',
          });
        doc.fillColor('#64748B').font('Helvetica').fontSize(6.5)
          .text(breakdownSummary, curX, startY + 18, { width: colWidths[3] - 10, ellipsis: true });
        curX += colWidths[3];

        // 5. Net Payable
        doc.fillColor('#047857').font('Helvetica-Bold').fontSize(8.5)
          .text(`Rs. ${net.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, curX, startY + 11, {
            width: colWidths[4] - 10,
            align: 'right',
          });
        curX += colWidths[4];

        // 6. Status Badge
        const statusBg = record.status === 'finalized' ? '#DCFCE7' : '#F1F5F9';
        const statusColor = record.status === 'finalized' ? '#15803D' : '#475569';
        doc.rect(curX + 6, startY + 8, colWidths[5] - 22, 15).fill(statusBg);
        doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(6.5)
          .text(statusText, curX + 6, startY + 12, { width: colWidths[5] - 22, align: 'center' });

        startY += rowHeight;
      });

      // --- Total Summary Row ---
      if (startY + 30 > 750) {
        doc.addPage();
        startY = 40;
      }

      doc.rect(startX, startY, totalWidth, 26).fill('#E2E8F0');
      let curX = startX + 6;

      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5)
        .text('TOTAL PAYOUT', curX, startY + 8, { width: colWidths[0] + colWidths[1] - 10 });
      curX += colWidths[0] + colWidths[1];

      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5)
        .text(`Rs. ${totalGross.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, curX, startY + 8, {
          width: colWidths[2] - 10,
          align: 'right',
        });
      curX += colWidths[2];

      doc.fillColor('#DC2626').font('Helvetica-Bold').fontSize(8.5)
        .text(`-Rs. ${totalDeductions.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, curX, startY + 8, {
          width: colWidths[3] - 10,
          align: 'left',
        });
      curX += colWidths[3];

      doc.fillColor('#047857').font('Helvetica-Bold').fontSize(9)
        .text(`Rs. ${totalNet.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, curX, startY + 8, {
          width: colWidths[4] - 10,
          align: 'right',
        });
      curX += colWidths[4];

      doc.fillColor('#64748B').font('Helvetica').fontSize(7.5)
        .text(`${payrollRecords.length} Emp`, curX, startY + 8, { width: colWidths[5] - 10, align: 'center' });

      // Footer notice
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(7)
        .text('Attendy HRM System • Confidential Payroll Document • Generated for Official Audit Use', 35, 780, {
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
