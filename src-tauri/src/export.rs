//! LANX 1.9.0: Excel export — a simple .xlsx (one sheet, a bold header row)
//! written with the zip library LANX already uses, readable by Excel,
//! LibreOffice and Google Sheets.

use std::io::Write;
use std::path::Path;

fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            // Characters XML doesn't allow at all.
            c if (c as u32) < 0x20 && c != '\n' && c != '\t' && c != '\r' => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

/// Excel's column letters: 0 → A, 25 → Z, 26 → AA.
fn col(mut i: usize) -> String {
    let mut s = String::new();
    loop {
        s.insert(0, (b'A' + (i % 26) as u8) as char);
        if i < 26 {
            break;
        }
        i = i / 26 - 1;
    }
    s
}

/// A sheet name Excel accepts (≤ 31 characters, none of []:*?/\).
fn sheet_name(name: &str) -> String {
    let s: String = name.chars().filter(|c| !"[]:*?/\\".contains(*c) && !c.is_control()).take(31).collect();
    if s.trim().is_empty() { "Sheet1".to_string() } else { s }
}

/// The workbook as bytes: `rows[0]` is the header.
pub fn xlsx_bytes(sheet: &str, rows: &[Vec<String>]) -> Result<Vec<u8>, String> {
    let ncols = rows.iter().map(|r| r.len()).max().unwrap_or(1).max(1);
    // Column widths from the content (capped).
    let widths: Vec<usize> = (0..ncols)
        .map(|c| rows.iter().map(|r| r.get(c).map(|v| v.lines().map(|l| l.chars().count()).max().unwrap_or(0)).unwrap_or(0)).max().unwrap_or(8).clamp(8, 80))
        .collect();
    let mut sheet_xml = String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>"#);
    for (i, w) in widths.iter().enumerate() {
        sheet_xml.push_str(&format!(r#"<col min="{0}" max="{0}" width="{1}" customWidth="1"/>"#, i + 1, w + 2));
    }
    sheet_xml.push_str("</cols><sheetData>");
    for (r, row) in rows.iter().enumerate() {
        sheet_xml.push_str(&format!(r#"<row r="{}">"#, r + 1));
        for (c, v) in row.iter().enumerate() {
            let v: String = v.chars().take(32_000).collect();
            let style = if r == 0 { r#" s="1""# } else if v.contains('\n') { r#" s="2""# } else { "" };
            sheet_xml.push_str(&format!(r#"<c r="{}{}" t="inlineStr"{}><is><t xml:space="preserve">{}</t></is></c>"#, col(c), r + 1, style, esc(&v)));
        }
        sheet_xml.push_str("</row>");
    }
    sheet_xml.push_str("</sheetData></worksheet>");

    let files: [(&str, String); 6] = [
        ("[Content_Types].xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>"#.to_string()),
        ("_rels/.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#.to_string()),
        ("xl/workbook.xml", format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{}" sheetId="1" r:id="rId1"/></sheets></workbook>"#, esc(&sheet_name(sheet)))),
        ("xl/_rels/workbook.xml.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#.to_string()),
        ("xl/styles.xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>"#.to_string()),
        ("xl/worksheets/sheet1.xml", sheet_xml),
    ];
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, body) in files.iter() {
            zip.start_file(*name, opts).map_err(|e| e.to_string())?;
            zip.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf.into_inner())
}

pub fn write_xlsx(path: &Path, sheet: &str, rows: &[Vec<String>]) -> Result<(), String> {
    let bytes = xlsx_bytes(sheet, rows)?;
    let partial = path.with_extension("partial");
    std::fs::write(&partial, bytes)
        .and_then(|_| std::fs::rename(&partial, path))
        .map_err(|e| {
            let _ = std::fs::remove_file(&partial);
            format!("Could not save {}: {}", path.display(), e)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn columns_and_sheet_names() {
        assert_eq!(col(0), "A");
        assert_eq!(col(25), "Z");
        assert_eq!(col(26), "AA");
        assert_eq!(col(27), "AB");
        assert_eq!(sheet_name("Chat: Asha / Bharat [2026]"), "Chat Asha  Bharat 2026");
    }

    #[test]
    fn workbook_is_a_valid_zip_with_escaped_text() {
        let rows = vec![
            vec!["Date".into(), "From".into(), "Message".into()],
            vec!["19 Oct".into(), "Asha".into(), "Price < ₹500 & \"fast\"\nsecond line".into()],
        ];
        let bytes = xlsx_bytes("Chat", &rows).unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut sheet = String::new();
        std::io::Read::read_to_string(&mut zip.by_name("xl/worksheets/sheet1.xml").unwrap(), &mut sheet).unwrap();
        assert!(sheet.contains("Price &lt; ₹500 &amp; &quot;fast&quot;"));
        assert!(sheet.contains(r#"r="C2""#));
        assert!(zip.by_name("[Content_Types].xml").is_ok());
    }
}
