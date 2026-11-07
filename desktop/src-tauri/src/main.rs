// No console window beside the program on Windows in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    armature_desktop_lib::run()
}
