import * as XLSX from 'xlsx';

// Flexible header matching so a sheet exported from anywhere still maps:
// we strip everything but letters and compare against known aliases.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const FIELD_ALIASES = {
  full_name: ['fullname', 'name', 'staffname', 'staff', 'fullnames', 'employeename'],
  email: ['email', 'emailaddress', 'mail', 'workemail', 'e'],
  phone_number: ['phonenumber', 'phone', 'mobile', 'mobilenumber', 'msisdn', 'tel', 'telephone', 'contact', 'phoneno'],
  department: ['department', 'dept', 'unit', 'team', 'division', 'role'],
};

const headerToField = (header) => {
  const n = norm(header);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(n)) return field;
  }
  return null;
};

// Parse the first sheet of an .xlsx/.xls/.csv file into staff rows
// { full_name, email, phone_number, department }. Blank rows are dropped.
export async function parseStaffSheet(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const rows = raw.map((r) => {
    const out = { full_name: '', email: '', phone_number: '', department: '' };
    for (const [key, value] of Object.entries(r)) {
      const field = headerToField(key);
      if (field) out[field] = String(value ?? '').trim();
    }
    return out;
  });
  return rows.filter((r) => r.full_name || r.email || r.phone_number);
}

// A ready-to-fill template with the exact headers the parser expects.
export function downloadStaffTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Full name', 'Email', 'Phone number', 'Department'],
    ['Jane Doe', 'jane@example.com', '+2348000000000', 'Finance'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Staff');
  XLSX.writeFile(wb, 'dilarion-staff-template.xlsx');
}
