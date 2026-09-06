import { useState, useMemo } from 'react';
import { Download, FileText, FileSpreadsheet, TableProperties } from 'lucide-react';

export default function Export({ toast, authFetch, subjects, students }) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selDept, setSelDept] = useState('');
  const [selYear, setSelYear] = useState('');
  const [selSubjectId, setSelSubjectId] = useState('');

  const departments = useMemo(() => [...new Set(students.map(s => s.department).filter(Boolean))].sort(), [students]);
  const years = useMemo(() => {
    if (!selDept) return [...new Set(students.map(s => s.year).filter(Boolean))].sort();
    return [...new Set(students.filter(s => s.department === selDept).map(s => s.year).filter(Boolean))].sort();
  }, [selDept, students]);

  const buildQS = (extra = {}) => {
    const p = new URLSearchParams();
    if (fromDate) p.set('from_date', fromDate);
    if (toDate)   p.set('to_date', toDate);
    if (selDept)  p.set('department', selDept);
    if (selYear)  p.set('year', selYear);
    if (selSubjectId) p.set('subject_id', selSubjectId);
    Object.entries(extra).forEach(([k,v]) => p.set(k, v));
    return p.toString();
  };

  const handleDownload = async (endpoint, filename) => {
    if (!fromDate || !toDate) { toast('Please select both From and To dates.', 'error'); return; }
    if (new Date(fromDate) > new Date(toDate)) { toast('From Date cannot be after To Date.', 'error'); return; }
    try {
      const res = await authFetch(`/api/export/${endpoint}?${buildQS()}`);
      if (!res.ok) { const e = await res.json(); toast(e.detail || 'Export failed', 'error'); return; }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`Downloaded: ${filename}`, 'success');
    } catch { toast('Export failed. Check backend.', 'error'); }
  };

  const inp = { className: 'form-input' };
  const Label = ({ children }) => <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 5 }}>{children}</label>;

  const activeFilters = [selDept, selYear, selSubjectId ? subjects.find(s=>String(s.id)===selSubjectId)?.code : ''].filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Filter Card */}
      <div className="metric-card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Export Filters</span>
          {(selDept || selYear || selSubjectId) && (
            <button onClick={() => { setSelDept(''); setSelYear(''); setSelSubjectId(''); }}
              style={{ fontSize: 12, fontWeight: 600, background: 'none', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 12px', color: 'var(--text-muted)', cursor: 'pointer' }}>
              Clear Filters
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 14 }}>
          <div><Label>From Date</Label><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} {...inp} style={{ width: '100%' }} /></div>
          <div><Label>To Date</Label><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} {...inp} style={{ width: '100%' }} /></div>
          <div>
            <Label>Department</Label>
            <select value={selDept} onChange={e=>{setSelDept(e.target.value);setSelYear('');}} {...inp} style={{ width: '100%' }}>
              <option value="">All Departments</option>
              {departments.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <Label>Year</Label>
            <select value={selYear} onChange={e=>setSelYear(e.target.value)} {...inp} style={{ width: '100%' }}>
              <option value="">All Years</option>
              {years.map(y=><option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <Label>Subject</Label>
            <select value={selSubjectId} onChange={e=>setSelSubjectId(e.target.value)} {...inp} style={{ width: '100%' }}>
              <option value="">All Subjects</option>
              {subjects.map(s=><option key={s.id} value={String(s.id)}>{s.code} — {s.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={() => { setFromDate(''); setToDate(''); setSelDept(''); setSelYear(''); setSelSubjectId(''); }} className="btn btn-outline" style={{ height: 42, width: '100%' }}>
              Reset All
            </button>
          </div>
        </div>

        {/* Active filter tags */}
        {activeFilters.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>Active filters:</span>
            {activeFilters.map(f=>(
              <span key={f} style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'var(--primary-light)', color: 'var(--primary)', border: '1px solid var(--primary)' }}>{f}</span>
            ))}
          </div>
        )}
      </div>

      {/* Export Buttons */}
      <div className="metric-card" style={{ padding: '20px 24px' }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 18 }}>Download Reports</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>

          <div style={{ flex: 1, minWidth: 200, border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <FileText size={18} color="var(--primary)" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Raw CSV</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
              All individual attendance records as a flat CSV file. One row per check-in.
            </p>
            <button onClick={() => handleDownload('csv', `attendance_${fromDate}_${toDate}.csv`)} className="btn btn-primary" style={{ width: '100%' }}>
              <FileText size={15} /> Download CSV
            </button>
          </div>

          <div style={{ flex: 1, minWidth: 200, border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <FileSpreadsheet size={18} color="#22c55e" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Excel Log</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
              Formatted Excel workbook with individual attendance log, styled with colors.
            </p>
            <button onClick={() => handleDownload('excel', `attendance_${fromDate}_${toDate}.xlsx`)} className="btn btn-success" style={{ width: '100%' }}>
              <FileSpreadsheet size={15} /> Download Excel
            </button>
          </div>

          <div style={{ flex: 1, minWidth: 200, border: '2px solid var(--primary)', borderRadius: 12, padding: '18px 20px', background: 'rgba(99,102,241,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <TableProperties size={18} color="var(--primary)" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Summary Report</span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'var(--primary)', color: '#fff', marginLeft: 4 }}>NEW</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
              Student-wise summary: each row is a student, each column is a subject with attendance %. Color-coded by threshold. Includes raw log on Sheet 2.
            </p>
            <button onClick={() => handleDownload('summary', `summary_${fromDate || 'all'}_${toDate || 'all'}.xlsx`)} className="btn btn-primary" style={{ width: '100%' }}>
              <TableProperties size={15} /> Download Summary Excel
            </button>
          </div>

        </div>
      </div>

      {/* Info box */}
      <div style={{ background: 'var(--bg-sidebar)', borderRadius: 10, padding: '14px 18px', fontSize: 13, color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
        <b style={{ color: 'var(--text-main)' }}>Exported fields (Raw):</b> Roll No, Name, Department, Year, Academic Year, Subject Code, Subject Name, Date, Time, Confidence Score
        <br /><b style={{ color: 'var(--text-main)' }}>Summary Report:</b> One row per student with % per subject + Overall %. Green ≥75%, Yellow ≥60%, Red &lt;60%.
      </div>
    </div>
  );
}
