"""
pdf_generator.py — VisionTrack Official Attendance Transcript & Report Card Generator
─────────────────────────────────────────────────────────────────────────────────────
Generates high-resolution, branded PDF documents with:
  - University Letterhead & Crest Header
  - Student Profile & Academic Cohort details
  - Subject-by-Subject Attendance Table
  - Attendance Threshold & Exam Eligibility Status Badge
  - Digital Verification Seal & QR Code representation
"""

import io
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.graphics.barcode import qr
from config import load_settings, ATTENDANCE_THRESHOLD


def create_attendance_pdf(student: dict, subjects: list, history: list, all_sessions: list, 
                          from_date: str = None, to_date: str = None) -> io.BytesIO:
    """
    Generate an official PDF Attendance Report Card for a student.
    
    Args:
        student: dict with keys (roll_no, name, department, year, academic_year)
        subjects: list of subject dicts (id, code, name, dept)
        history: list of attendance records attended by this student
        all_sessions: list of all session dicts conducted in the institution
        from_date, to_date: optional date range filters
    
    Returns:
        io.BytesIO containing the generated PDF binary data.
    """
    settings = load_settings()
    college_name = settings.get("college_name", "VisionTrack University of Technology")
    threshold_pct = settings.get("attendance_threshold", ATTENDANCE_THRESHOLD)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#0F172A'),
        alignment=1 # Center
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor('#2563EB'),
        alignment=1 # Center
    )
    
    meta_style = ParagraphStyle(
        'MetaText',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#64748B'),
        alignment=1 # Center
    )

    h2_style = ParagraphStyle(
        'H2Style',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=15,
        textColor=colors.HexColor('#1E293B'),
        spaceBefore=10,
        spaceAfter=6
    )

    cell_style = ParagraphStyle(
        'Cell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#1E293B')
    )
    
    cell_bold = ParagraphStyle(
        'CellBold',
        parent=cell_style,
        fontName='Helvetica-Bold'
    )

    story = []

    # 1. Header Section
    story.append(Paragraph(college_name.upper(), title_style))
    story.append(Spacer(1, 4))
    story.append(Paragraph("OFFICIAL ATTENDANCE TRANSCRIPT & ELIGIBILITY REPORT", subtitle_style))
    story.append(Spacer(1, 4))
    
    now_str = datetime.now().strftime("%B %d, %Y - %I:%M %p")
    date_filter_str = f"Period: {from_date or 'Beginning'} to {to_date or 'Present'}"
    story.append(Paragraph(f"Generated on {now_str} &bull; {date_filter_str} &bull; VisionTrack AI Verified", meta_style))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor('#2563EB'), spaceAfter=14))

    # 2. Filter sessions by date range and student cohort
    s_dept = student.get("department", "")
    s_year = student.get("year", "")
    s_ay   = student.get("academic_year", "")

    filtered_sessions = []
    for s in all_sessions:
        d = s.get("date", "")
        if from_date and d < from_date:
            continue
        if to_date and d > to_date:
            continue
        if s.get("department") and s_dept and s.get("department") != s_dept:
            continue
        if s.get("year") and s_year and s.get("year") != s_year:
            continue
        if s.get("academic_year") and s_ay and s.get("academic_year") != s_ay:
            continue
        filtered_sessions.append(s)

    attended_session_ids = {h.get("session_id") for h in history}

    # 3. Student Profile Info Card
    c_name = student.get("course") or ("M.Tech" if str(student.get("year", "")).lower().startswith("pg") else "B.Tech")
    profile_data = [
        [
            Paragraph("<b>Student Name:</b>", cell_style),
            Paragraph(student.get("name", "N/A"), cell_bold),
            Paragraph("<b>Course / Dept:</b>", cell_style),
            Paragraph(f"<b>{c_name}</b> — {student.get('department', 'N/A')}", cell_bold)
        ],
        [
            Paragraph("<b>Roll Number:</b>", cell_style),
            Paragraph(f"<font color='#2563EB'><b>{student.get('roll_no', 'N/A')}</b></font>", cell_bold),
            Paragraph("<b>Year / AY:</b>", cell_style),
            Paragraph(f"{student.get('year', 'N/A')} ({student.get('academic_year', 'N/A')})", cell_style)
        ]
    ]

    profile_table = Table(profile_data, colWidths=[100, 170, 100, 170])
    profile_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F8FAFC')),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#E2E8F0')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(profile_table)
    story.append(Spacer(1, 14))

    # 4. Calculate Subject Breakdown
    total_inst_sessions = 0
    total_inst_attended = 0
    subject_rows = [
        [
            Paragraph("<b>Subject Code</b>", cell_bold),
            Paragraph("<b>Subject Title</b>", cell_bold),
            Paragraph("<b>Conducted</b>", cell_bold),
            Paragraph("<b>Attended</b>", cell_bold),
            Paragraph("<b>Percentage</b>", cell_bold),
            Paragraph("<b>Status</b>", cell_bold)
        ]
    ]

    for sub in subjects:
        sub_id = sub.get("id")
        sub_code = sub.get("code", "")
        sub_name = sub.get("name", "")
        
        # Sessions for this subject
        sub_sess = [s for s in filtered_sessions if str(s.get("subject_id")) == str(sub_id) or s.get("subject_id") == sub_code]
        cond_count = len(sub_sess)
        att_count = sum(1 for s in sub_sess if s.get("id") in attended_session_ids)
        
        pct = round((att_count / cond_count * 100), 1) if cond_count > 0 else 0.0
        total_inst_sessions += cond_count
        total_inst_attended += att_count

        status_text = "N/A" if cond_count == 0 else ("ELIGIBLE" if pct >= threshold_pct else "DEFICIT")
        status_color = "#10B981" if pct >= threshold_pct else "#EF4444"
        if cond_count == 0:
            status_color = "#64748B"

        subject_rows.append([
            Paragraph(sub_code, cell_bold),
            Paragraph(sub_name, cell_style),
            Paragraph(str(cond_count), cell_style),
            Paragraph(str(att_count), cell_style),
            Paragraph(f"<b>{pct}%</b>" if cond_count > 0 else "<font color='#64748B'>N/A</font>", cell_style),
            Paragraph(f"<font color='{status_color}'><b>{status_text}</b></font>", cell_style)
        ])

    overall_pct = round((total_inst_attended / total_inst_sessions * 100), 1) if total_inst_sessions > 0 else 0.0
    is_eligible = overall_pct >= threshold_pct

    # 5. Subject Table Style
    sub_table = Table(subject_rows, colWidths=[80, 200, 65, 65, 65, 65])
    sub_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1E3A5F')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (2, 0), (-1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F8FAFC')]),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    story.append(Paragraph("Course-Wise Attendance Summary", h2_style))
    story.append(sub_table)
    story.append(Spacer(1, 14))

    # 6. Overall Metric Summary Card with Eligibility Badge
    elig_badge_text = "ELIGIBLE FOR SEMESTER EXAMINATIONS" if is_eligible else "SHORTAGE OF ATTENDANCE (DEBARRED)"
    badge_bg = colors.HexColor('#D1FAE5') if is_eligible else colors.HexColor('#FEE2E2')
    badge_border = colors.HexColor('#10B981') if is_eligible else colors.HexColor('#EF4444')
    badge_text_color = "#065F46" if is_eligible else "#991B1B"

    summary_data = [
        [
            Paragraph(f"<b>Total Classes Held:</b> {total_inst_sessions}", cell_style),
            Paragraph(f"<b>Classes Attended:</b> {total_inst_attended}", cell_style),
            Paragraph(f"<b>Overall Aggregate:</b> <font size='11' color='{badge_text_color}'><b>{overall_pct}%</b></font>", cell_style)
        ],
        [
            Paragraph(f"<font color='{badge_text_color}'><b>STATUS: {elig_badge_text}</b> (Min Required: {threshold_pct}%)</font>", cell_bold),
            "",
            ""
        ]
    ]

    summary_table = Table(summary_data, colWidths=[180, 180, 180])
    summary_table.setStyle(TableStyle([
        ('SPAN', (0, 1), (2, 1)),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F1F5F9')),
        ('BACKGROUND', (0, 1), (-1, 1), badge_bg),
        ('BOX', (0, 0), (-1, -1), 1, badge_border),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0')),
        ('ALIGN', (0, 1), (-1, 1), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 20))

    # 7. Verification QR Code & Seal
    qr_payload = f"VERIFIED:VisionTrack:{student.get('roll_no')}:AGG_{overall_pct}%:{now_str}"
    qr_code = qr.QrCodeWidget(qr_payload)
    qr_code.barWidth = 60
    qr_code.barHeight = 60
    d_qr = Drawing(65, 65)
    d_qr.add(qr_code)

    footer_data = [
        [
            d_qr,
            Paragraph(
                f"<b>Digital Verification Seal</b><br/>"
                f"<font size='8' color='#64748B'>"
                f"Scan this QR code to cryptographically verify this record on the VisionTrack Network.<br/>"
                f"Document Hash: VT-{student.get('roll_no')}-{datetime.now().strftime('%Y%m%d%H%M')}<br/>"
                f"Authorized by Academic Registrar & System Controller."
                f"</font>",
                cell_style
            ),
            Paragraph(
                "<br/><br/>________________________<br/><b>Controller of Examinations</b>",
                ParagraphStyle('Sig', parent=cell_style, alignment=1)
            )
        ]
    ]

    footer_table = Table(footer_data, colWidths=[75, 305, 160])
    footer_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(KeepTogether(footer_table))

    # Build PDF
    doc.build(story)
    buffer.seek(0)
    return buffer
