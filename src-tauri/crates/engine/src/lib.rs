//! Reads the Houdini help out of an install on this machine.
//!
//! The crate owns the whole read: it finds the installs, reads a page out of a
//! zip, parses the markup with `wiki`, fills the FTS5 index and ranks a search.
//! It knows nothing about a window, a command or a client — the Tauri app and
//! the Python module are two callers of the same code.
//!
//! No documentation content lives here. Every page comes from the reader's own
//! install.

pub mod assets;
pub mod db;
pub mod examples;
pub mod family;
pub mod help;
pub mod index;
pub mod inherit;
pub mod install;
pub mod listing;
pub mod packages;
pub mod page;
pub mod picture;
pub mod place;
pub mod search;
pub mod sections;
pub mod versions;

/// The database type every call here takes, so a caller needs no version of
/// its own.
pub use rusqlite;

pub use page::{PageError, PageView, node_type, read as read_page};
pub use search::{Hit, Meta, Section, all_titles, find, read_meta};
