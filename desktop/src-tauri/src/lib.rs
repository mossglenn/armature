//! The Armature desktop program's shell (docs/desktop-program-plan.md §3; ADR-0069 decision 1).

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("the Armature shell failed to start");
}
