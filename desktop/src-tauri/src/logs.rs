//! The core's output kept on disk (docs/desktop-program-plan.md §9): the program's log folder, one
//! file per day, `armature-YYYY-MM-DD.log`, the last seven kept. A line is the time, the level and
//! the text. Nothing written here is a token: the core logs none, and the shell logs only what the
//! core sent as `log` and what it says itself.
//!
//! A day's file ends at `MAX_DAY_BYTES` (the 2026-11-09 review's S10): a fault that repeats a line
//! without end no longer fills the disk. The file says once that it is full; the lines after that
//! are still shown on the Log page, which reads them from memory, and tomorrow's file starts empty.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const KEPT_DAYS: usize = 7;
/// The most one day's file holds: about a hundred thousand lines, far over a day's ordinary log.
pub const MAX_DAY_BYTES: u64 = 16 * 1024 * 1024;
const PREFIX: &str = "armature-";
const SUFFIX: &str = ".log";

pub struct LogFiles {
    dir: PathBuf,
    day: String,
    /// The most today's file may hold; `MAX_DAY_BYTES` but for a test.
    limit: u64,
    /// Set once today's file has been told it is full, so it is told once.
    full: bool,
}

impl LogFiles {
    pub fn open(dir: PathBuf) -> Self {
        Self::with_limit(dir, MAX_DAY_BYTES)
    }

    pub fn with_limit(dir: PathBuf, limit: u64) -> Self {
        let _ = fs::create_dir_all(&dir);
        LogFiles { dir, day: String::new(), limit, full: false }
    }

    /// Appends one line to today's file, removing the oldest files when the day changes.
    pub fn write(&mut self, level: &str, text: &str) {
        let now = chrono::Local::now();
        let day = now.format("%Y-%m-%d").to_string();
        if day != self.day {
            self.day = day.clone();
            self.full = false;
            prune(&self.dir, KEPT_DAYS);
        }
        let path = self.dir.join(format!("{PREFIX}{day}{SUFFIX}"));
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            if file.metadata().map(|m| m.len()).unwrap_or(0) >= self.limit {
                if !self.full {
                    self.full = true;
                    let _ = writeln!(file, "{} {:<5} This day's log file is full; later lines are on the Log page only until tomorrow", now.format("%H:%M:%S"), "warn");
                }
                return;
            }
            for line in text.lines() {
                let _ = writeln!(file, "{} {:<5} {}", now.format("%H:%M:%S"), level, line);
            }
        }
    }
}

/// Removes all but the newest `keep` day files in `dir`; other files are left alone.
pub fn prune(dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut days: Vec<String> = entries
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| name.starts_with(PREFIX) && name.ends_with(SUFFIX))
        .collect();
    days.sort();
    let excess = days.len().saturating_sub(keep);
    for name in days.into_iter().take(excess) {
        let _ = fs::remove_file(dir.join(name));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_newest_days_and_nothing_else_is_touched() {
        let dir = std::env::temp_dir().join(format!("armature-logs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for day in 1..=9 {
            fs::write(dir.join(format!("armature-2026-11-0{day}.log")), "x").unwrap();
        }
        fs::write(dir.join("other.txt"), "x").unwrap();
        prune(&dir, 7);
        let mut left: Vec<String> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        left.sort();
        assert_eq!(left.len(), 8);
        assert_eq!(left[0], "armature-2026-11-03.log");
        assert!(left.contains(&"other.txt".to_string()));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_days_file_ends_at_its_limit_and_says_so_once() {
        let dir = std::env::temp_dir().join(format!("armature-logs-full-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut logs = LogFiles::with_limit(dir.clone(), 200);
        for _ in 0..50 {
            logs.write("error", "the same line, again and again");
        }
        let file = fs::read_dir(&dir).unwrap().next().unwrap().unwrap().path();
        let text = fs::read_to_string(file).unwrap();
        // Written until the limit was passed, then one line saying so, then nothing.
        assert!(text.len() < 400, "{}", text.len());
        assert_eq!(text.lines().filter(|line| line.contains("is full")).count(), 1);
        assert!(text.lines().last().unwrap().contains("is full"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn writes_each_line_with_its_level() {
        let dir = std::env::temp_dir().join(format!("armature-logs-write-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut logs = LogFiles::open(dir.clone());
        logs.write("warn", "one\ntwo");
        let file = fs::read_dir(&dir).unwrap().next().unwrap().unwrap().path();
        let text = fs::read_to_string(file).unwrap();
        assert_eq!(text.lines().count(), 2);
        assert!(text.lines().all(|line| line.contains("warn ")));
        fs::remove_dir_all(&dir).unwrap();
    }
}
