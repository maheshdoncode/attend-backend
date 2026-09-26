import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/**
 * Generates an Excel workbook buffer for monthly employee attendance.
 * @param {Array} employees - [{ name, employee_code, department, days: [{ day, status }] }]
 * @param {number} month
 * @param {number} year
 * @returns {Promise<Buffer>}
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
    fgColor: { argb: 'FF1F4E79' },
  };
  worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

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

    // Initialize all days
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
      if (cell.value === 'P') cell.font = { color: { argb: 'FF008000' }, bold: true };
      else if (cell.value === 'A') cell.font = { color: { argb: 'FFC00000' }, bold: true };
      else if (cell.value === 'L') cell.font = { color: { argb: 'FFE26B00' }, bold: true };
      else if (cell.value === 'HD') cell.font = { color: { argb: 'FF7030A0' }, bold: true };
      else if (cell.value === 'H' || cell.value === 'OFF') cell.font = { color: { argb: 'FF0284C7' }, bold: true };
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

/**
 * Generates a PDF buffer containing the monthly payroll summary report.
 * @param {Array} payrollRecords - [{ name, employee_code, gross_salary, total_deduction_amount, deduction_breakdown, net_salary }]
 * @param {number} month
 * @param {number} year
 * @returns {Promise<Buffer>}
 */
export const generatePayrollPDF = (payrollRecords, month, year) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Title & Header
      doc.fontSize(20).font('Helvetica-Bold').text('Attendy HRMS - Payroll Report', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).font('Helvetica').text(`Period: Month ${month} / Year ${year}`, { align: 'center' });
      doc.fontSize(10).fillColor('#666666').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown(1.5);

      // Table Setup
      const startX = 40;
      let startY = doc.y;
      const colWidths = [140, 75, 180, 80]; // Name, Gross, Deductions, Net
      const headers = ['Employee', 'Gross (₹)', 'Deductions Breakdown', 'Net (₹)'];

      // Header Row
      doc.rect(startX, startY, 475, 24).fill('#1F4E79');
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10);

      let currentX = startX + 5;
      headers.forEach((header, index) => {
        const align = index === 0 || index === 2 ? 'left' : 'right';
        doc.text(header, currentX, startY + 7, { width: colWidths[index] - 10, align });
        currentX += colWidths[index];
      });

      startY += 24;
      doc.fillColor('#000000').font('Helvetica').fontSize(9);

      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;

      payrollRecords.forEach((record, i) => {
        // Page break if near bottom
        if (startY > 720) {
          doc.addPage();
          startY = 40;
        }

        const gross = Number(record.gross_salary || 0);
        const deduction = Number(record.total_deduction_amount || 0);
        const net = Number(record.net_salary || 0);

        totalGross += gross;
        totalDeductions += deduction;
        totalNet += net;

        // Breakdown text
        let breakdownText = '-';
        if (Array.isArray(record.deduction_breakdown) && record.deduction_breakdown.length > 0) {
          breakdownText = record.deduction_breakdown
            .map((item) => `${item.reason}: ₹${Number(item.amount || 0).toFixed(2)}`)
            .join(', ');
        } else if (deduction > 0) {
          breakdownText = `Total: ₹${deduction.toFixed(2)}`;
        }

        const rowHeight = Math.max(22, Math.ceil(breakdownText.length / 32) * 14);

        // Alternating row background
        if (i % 2 === 1) {
          doc.rect(startX, startY, 475, rowHeight).fill('#F2F4F7');
        }

        doc.fillColor('#000000');
        currentX = startX + 5;

        // Employee Name
        const empName = `${record.name || 'Unknown'}\n(${record.employee_code || 'N/A'})`;
        doc.text(empName, currentX, startY + 4, { width: colWidths[0] - 10, align: 'left' });
        currentX += colWidths[0];

        // Gross
        doc.text(`₹${gross.toFixed(2)}`, currentX, startY + 4, { width: colWidths[1] - 10, align: 'right' });
        currentX += colWidths[1];

        // Deductions Breakdown
        doc.text(breakdownText, currentX, startY + 4, { width: colWidths[2] - 10, align: 'left' });
        currentX += colWidths[2];

        // Net
        doc.font('Helvetica-Bold').text(`₹${net.toFixed(2)}`, currentX, startY + 4, {
          width: colWidths[3] - 10,
          align: 'right',
        });
        doc.font('Helvetica');

        startY += rowHeight;
      });

      // Summary / Total Row
      if (startY > 720) {
        doc.addPage();
        startY = 40;
      }

      doc.rect(startX, startY, 475, 25).fill('#EAECEE');
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(10);
      currentX = startX + 5;

      doc.text('TOTAL', currentX, startY + 7, { width: colWidths[0] - 10, align: 'left' });
      currentX += colWidths[0];
      doc.text(`₹${totalGross.toFixed(2)}`, currentX, startY + 7, { width: colWidths[1] - 10, align: 'right' });
      currentX += colWidths[1];
      doc.text(`₹${totalDeductions.toFixed(2)}`, currentX, startY + 7, { width: colWidths[2] - 10, align: 'left' });
      currentX += colWidths[2];
      doc.text(`₹${totalNet.toFixed(2)}`, currentX, startY + 7, { width: colWidths[3] - 10, align: 'right' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

export default {
  generateAttendanceExcel,
  generatePayrollPDF,
};
