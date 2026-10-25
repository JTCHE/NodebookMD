// Windows release builds open no console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nodebookmd_lib::run()
}
