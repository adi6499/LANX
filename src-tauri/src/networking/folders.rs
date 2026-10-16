//! LANX 1.2.3: sending whole folders.
//!
//! A folder is packed into one zip (fast compression; photos, videos and
//! archives are stored as they are because they don't shrink), sent like any
//! file — encrypted, resumable, checked — and unpacked on arrival by LANX
//! 1.2.3 or newer. Older versions simply receive the .zip.

use std::fs::{self, File};
use std::io::{self, BufWriter};
use std::path::{Component, Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Packed folders waiting to be sent live here.
pub fn outbox_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("Outbox")
}

/// Already-compressed formats: compressing them again only costs time.
pub(crate) fn store_only(name: &str) -> bool {
    let ext = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "zip" | "7z" | "rar" | "gz" | "tgz" | "bz2" | "xz" | "zst" | "cab" | "jpg" | "jpeg" | "png" | "gif"
            | "webp" | "heic" | "mp4" | "mkv" | "mov" | "avi" | "webm" | "mp3" | "m4a" | "aac" | "ogg"
            | "flac" | "docx" | "xlsx" | "pptx" | "odt" | "ods" | "pdf" | "jar" | "apk" | "msi" | "iso"
    )
}

#[derive(Debug)]
pub struct Packed {
    pub zip: PathBuf,
    pub files: u64,
    pub bytes: u64,
}

fn walk(dir: &Path, rel: &str, out: &mut Vec<(PathBuf, String, bool)>) -> io::Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let ft = e.file_type()?;
        if ft.is_symlink() {
            continue; // never follow links out of the folder
        }
        let name = e.file_name().to_string_lossy().to_string();
        let r = if rel.is_empty() { name } else { format!("{}/{}", rel, name) };
        if ft.is_dir() {
            out.push((e.path(), format!("{}/", r), true));
            walk(&e.path(), &r, out)?;
        } else if ft.is_file() {
            out.push((e.path(), r, false));
        }
    }
    Ok(())
}

/// Packs `folder` into `<outbox>/<id>/<Folder name>.zip`.
pub fn pack_folder(folder: &Path, outbox: &Path) -> Result<Packed, String> {
    let name = folder
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Folder".to_string());
    let dir = outbox.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&dir).map_err(|e| format!("Could not prepare the folder: {}", e))?;
    let zip_path = dir.join(format!("{}.zip", name));
    let mut entries = Vec::new();
    walk(folder, "", &mut entries).map_err(|e| format!("Could not read the folder \"{}\": {}", name, e))?;
    if entries.is_empty() {
        return Err(format!("The folder \"{}\" is empty.", name));
    }
    let file = File::create(&zip_path).map_err(|e| format!("Could not pack the folder: {}", e))?;
    let mut zw = ZipWriter::new(BufWriter::with_capacity(1024 * 1024, file));
    let mut files = 0u64;
    let mut bytes = 0u64;
    let result = (|| -> Result<(), String> {
        for (path, rel, is_dir) in &entries {
            if *is_dir {
                zw.add_directory(rel.as_str(), SimpleFileOptions::default())
                    .map_err(|e| e.to_string())?;
                continue;
            }
            let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            let opts = SimpleFileOptions::default()
                .compression_method(if store_only(rel) { CompressionMethod::Stored } else { CompressionMethod::Deflated })
                .compression_level(if store_only(rel) { None } else { Some(1) })
                .large_file(size >= u32::MAX as u64);
            zw.start_file(rel.as_str(), opts).map_err(|e| e.to_string())?;
            let mut src = match File::open(path) {
                Ok(f) => f,
                Err(e) => return Err(format!("Could not read \"{}\": {}", rel, e)),
            };
            io::copy(&mut src, &mut zw).map_err(|e| format!("Could not pack \"{}\": {}", rel, e))?;
            files += 1;
            bytes += size;
        }
        zw.finish().map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_dir_all(&dir);
        return Err(e);
    }
    Ok(Packed { zip: zip_path, files, bytes })
}

/// Unpacks a received folder zip into `target` (which must not exist yet).
/// Entries that would land outside `target` are skipped.
pub fn unpack_zip(zip_path: &Path, target: &Path) -> Result<u64, String> {
    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("not a valid zip ({})", e))?;
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    let mut count = 0u64;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name() else { continue };
        if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
            continue;
        }
        let out = target.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut f = File::create(&out).map_err(|e| format!("{}: {}", rel.display(), e))?;
        io::copy(&mut entry, &mut f).map_err(|e| format!("{}: {}", rel.display(), e))?;
        count += 1;
    }
    Ok(count)
}

/// Removes packed folders older than `days` (they were sent long ago).
pub fn clean_outbox(outbox: &Path, days: u64) {
    let Ok(entries) = fs::read_dir(outbox) else { return };
    let limit = std::time::Duration::from_secs(days * 24 * 3600);
    for e in entries.flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > limit);
        if old {
            let _ = fs::remove_dir_all(e.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_round_trip_keeps_structure_and_bytes() {
        let src = tempfile::tempdir().unwrap();
        let root = src.path().join("Q3 Accounts");
        fs::create_dir_all(root.join("sheets/old")).unwrap();
        fs::create_dir_all(root.join("empty")).unwrap();
        fs::write(root.join("readme.txt"), "hello ".repeat(10_000)).unwrap();
        fs::write(root.join("sheets/old/jan.csv"), b"a,b,c\n1,2,3\n").unwrap();
        let photo: Vec<u8> = (0..300_000u32).map(|i| (i * 7919 % 251) as u8).collect();
        fs::write(root.join("sheets/photo.jpg"), &photo).unwrap();

        let outbox = src.path().join("Outbox");
        let packed = pack_folder(&root, &outbox).unwrap();
        assert_eq!(packed.files, 3);
        assert_eq!(packed.zip.file_name().unwrap(), "Q3 Accounts.zip");
        assert!(fs::metadata(&packed.zip).unwrap().len() < 100_000 + photo.len() as u64, "text was compressed");

        let dest = tempfile::tempdir().unwrap();
        let target = dest.path().join("Q3 Accounts");
        assert_eq!(unpack_zip(&packed.zip, &target).unwrap(), 3);
        assert_eq!(fs::read_to_string(target.join("readme.txt")).unwrap(), "hello ".repeat(10_000));
        assert_eq!(fs::read(target.join("sheets/old/jan.csv")).unwrap(), b"a,b,c\n1,2,3\n");
        assert_eq!(fs::read(target.join("sheets/photo.jpg")).unwrap(), photo);
        assert!(target.join("empty").is_dir());
    }

    #[test]
    fn empty_folders_are_refused_and_bad_zips_never_escape() {
        let src = tempfile::tempdir().unwrap();
        let empty = src.path().join("Nothing");
        fs::create_dir_all(&empty).unwrap();
        assert!(pack_folder(&empty, &src.path().join("Outbox")).unwrap_err().contains("empty"));

        // A hostile zip with "../" names writes nothing outside the target.
        let evil = src.path().join("evil.zip");
        {
            let mut zw = ZipWriter::new(File::create(&evil).unwrap());
            zw.start_file("../outside.txt", SimpleFileOptions::default()).unwrap();
            io::Write::write_all(&mut zw, b"x").unwrap();
            zw.start_file("ok/inside.txt", SimpleFileOptions::default()).unwrap();
            io::Write::write_all(&mut zw, b"y").unwrap();
            zw.finish().unwrap();
        }
        let target = src.path().join("out");
        assert_eq!(unpack_zip(&evil, &target).unwrap(), 1);
        assert!(!src.path().join("outside.txt").exists());
        assert!(target.join("ok/inside.txt").exists());
    }
}
