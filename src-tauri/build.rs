fn main() {
    // Tauri normally embeds its Windows manifest (Common Controls v6) only in
    // the app binary, so `cargo test` executables crash at launch with
    // STATUS_ENTRYPOINT_NOT_FOUND. Embed the same manifest in every binary
    // (app and tests) through the linker instead.
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let mut attributes = tauri_build::Attributes::new();
    if target_os == "windows" && target_env == "msvc" {
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }
    // LANX 3.0: the phone page (phone-dist) comes from `npm run build:phone`;
    // placeholders let `cargo test` compile before it has been built.
    let dist = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("phone-dist");
    let _ = std::fs::create_dir_all(&dist);
    for (name, body) in [
        ("phone.html", "<!doctype html><meta charset=\"utf-8\"><title>LANX</title><p>The phone page was not built (run: npm run build:phone).</p>"),
        ("phone.js", ""),
        ("phone.css", ""),
    ] {
        let p = dist.join(name);
        if !p.exists() {
            let _ = std::fs::write(&p, body);
        }
    }
    // Every file in phone-dist (the page, its hashed script, styles, fonts),
    // listed for `include_bytes!` so lanx.exe carries the whole page.
    fn walk(dir: &std::path::Path, base: &std::path::Path, out: &mut Vec<(String, std::path::PathBuf)>) {
        if let Ok(rd) = std::fs::read_dir(dir) {
            let mut items: Vec<_> = rd.flatten().map(|e| e.path()).collect();
            items.sort();
            for p in items {
                if p.is_dir() {
                    walk(&p, base, out);
                } else if let Ok(rel) = p.strip_prefix(base) {
                    out.push((rel.to_string_lossy().replace('\\', "/"), p));
                }
            }
        }
    }
    let mut entries = Vec::new();
    walk(&dist, &dist, &mut entries);
    let mut src = String::from("pub static PHONE_FILES: &[(&str, &[u8])] = &[\n");
    for (rel, path) in &entries {
        src.push_str(&format!("    ({:?}, include_bytes!({:?})),\n", rel, path.to_string_lossy()));
    }
    src.push_str("];\n");
    let out = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("phone_assets.rs");
    std::fs::write(out, src).expect("write phone_assets.rs");
    println!("cargo:rerun-if-changed=phone-dist");
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
