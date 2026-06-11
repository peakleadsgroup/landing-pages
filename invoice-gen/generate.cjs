const fs = require('fs');
const path = require('path');
const { jsPDF } = require('jspdf');

const LOGO_URL = 'https://peakleadsgroup.com/Images/Peak%20Leads%20Flattened%20Logo.png';

const lines = [
  { desc: 'New Bath Today IN', qty: 21, unit: 110 },
  { desc: 'New Bath Today TX', qty: 62, unit: 110 },
  { desc: 'New Bath Today OH', qty: 38, unit: 110 },
  { desc: 'New Bath Today TN', qty: 21, unit: 110 },
  { desc: 'New Bath Today AL', qty: 51, unit: 110 },
];

const invoiceDate = 'June 10, 2026';
const dueDate = 'July 1, 2026';
const chargeId = 'NBT-2026-05-01';
const billToName = 'New Bath Today';

function money(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** PNG IHDR width/height so logo fits max box without squishing (same logic as Dashboards/recordID.html). */
function getPngDimensions(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf.slice(1, 4).toString('ascii') !== 'PNG') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function logoDrawSize(buf) {
  const maxW = 60;
  const maxH = 24;
  const dims = getPngDimensions(buf);
  if (!dims || !dims.width || !dims.height) return { w: maxW, h: maxH };
  const aspect = dims.width / dims.height;
  if (aspect >= maxW / maxH) {
    return { w: maxW, h: maxW / aspect };
  }
  return { w: maxH * aspect, h: maxH };
}

async function main() {
  const totalAmount = lines.reduce((s, row) => s + row.qty * row.unit, 0);

  let logoData = null;
  let logoBuf = null;
  try {
    const res = await fetch(LOGO_URL);
    if (res.ok) {
      logoBuf = Buffer.from(await res.arrayBuffer());
      logoData = 'data:image/png;base64,' + logoBuf.toString('base64');
    }
  } catch (_) {}

  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = 15;
  const invoiceTopY = 15;

  if (logoData && logoBuf) {
    const { w, h } = logoDrawSize(logoBuf);
    doc.addImage(logoData, 'PNG', pageW - margin - w, invoiceTopY, w, h);
  } else {
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Peak Leads Group', pageW - margin, invoiceTopY + 12, { align: 'right' });
  }

  doc.setFontSize(28);
  doc.setFont(undefined, 'bold');
  doc.text('Invoice', margin, y + 20);
  y += 38;

  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  doc.text(`Charge ID: ${chargeId}`, margin, y);
  y += 6;
  doc.text(`Date: ${invoiceDate}`, margin, y);
  y += 6;
  doc.text(`Due: ${dueDate}`, margin, y);
  y += 22;

  const colMid = pageW / 2;
  const fromY = y;
  doc.text('Peak Leads Group', margin, fromY);
  doc.text('105 Buckhaven Court', margin, fromY + 6);
  doc.text('Apex, North Carolina 27502', margin, fromY + 12);
  doc.text('United States', margin, fromY + 18);

  doc.setFont(undefined, 'bold');
  doc.text('Bill to', colMid, fromY);
  doc.setFont(undefined, 'normal');
  doc.text(billToName || '—', colMid, fromY + 6);
  y = fromY + 28;

  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text(`$${money(totalAmount)} USD`, margin, y);
  doc.setFontSize(11);
  doc.setFont(undefined, 'normal');
  y += 10;

  doc.text('Lead delivery — IN, TX, OH, TN, AL', margin, y);
  y += 15;

  y += 5;
  doc.setDrawColor(180, 180, 180);
  doc.line(margin, y, pageW - margin, y);
  y += 12;

  const colQty = 100;
  const colUnit = 122;
  const colTotalX = pageW - margin;
  const descMaxW = colQty - margin - 4;

  doc.setFont(undefined, 'bold');
  doc.text('Description', margin, y);
  doc.text('Qty', colQty, y);
  doc.text('Unit price', colUnit, y);
  doc.text('Total', colTotalX, y, { align: 'right' });
  y += 10;

  doc.setFont(undefined, 'normal');
  for (const row of lines) {
    const lineTotal = row.qty * row.unit;
    const parts = doc.splitTextToSize(row.desc, descMaxW);
    const rowHeight = Math.max(10, parts.length * 5);
    let lineY = y;
    parts.forEach((line, i) => {
      doc.text(line, margin, lineY + i * 5);
    });
    doc.text(String(row.qty), colQty, y);
    doc.text(`$${money(row.unit)}`, colUnit, y);
    doc.text(`$${money(lineTotal)}`, colTotalX, y, { align: 'right' });
    y += rowHeight;
  }

  y += 2;
  doc.setDrawColor(180, 180, 180);
  doc.line(margin, y, pageW - margin, y);
  y += 12;

  const totLabelX = 130;
  const totValX = pageW - margin;
  const totStr = money(totalAmount);
  doc.text('Subtotal', totLabelX, y);
  doc.text(`$${totStr}`, totValX, y, { align: 'right' });
  y += 6;
  doc.text('Total', totLabelX, y);
  doc.text(`$${totStr}`, totValX, y, { align: 'right' });
  y += 6;
  doc.setFont(undefined, 'bold');
  doc.text('Amount charged', totLabelX, y);
  doc.text(`$${totStr} USD`, totValX, y, { align: 'right' });

  const outPath = path.join(__dirname, '..', 'InternalApps', 'New-Bath-Today-invoice-2026-05-01.pdf');
  const buf = doc.output('arraybuffer');
  fs.writeFileSync(outPath, Buffer.from(buf));
  console.log('Wrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
