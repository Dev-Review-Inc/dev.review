// The agent in a terminal: `claude --resume <session>` in a pseudo-terminal,
// in the folder the agent ran in, for the reader to talk to directly.
//
// Output streams as raw bytes over a Channel; the exit arrives on the same
// Channel as JSON. Everything from the draft goes into argv, never a shell.
//
// Desktop only, for the reason git.rs is: App Sandbox and iOS forbid spawning
// a subprocess. lib.rs compiles this module out under both.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

/// What to open.
#[derive(Deserialize)]
pub struct Request {
    pub session: String,
    /// The folder the agent ran in.
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

struct Open {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// The terminals open, by id.
#[derive(Default, Clone)]
pub struct Terminals(Arc<Mutex<HashMap<u32, Open>>>, Arc<AtomicU32>);

/// Why a terminal did not open. `code` is what the frontend branches on.
#[derive(Serialize, Debug, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub message: String,
}

pub(crate) fn refuse(code: &'static str, message: &str) -> Refusal {
    Refusal { code, message: message.to_string() }
}

/// The arguments `claude` gets.
pub fn arguments(session: &str) -> Vec<String> {
    vec!["--resume".into(), session.into()]
}

/// Whether this machine can resume `session` in `cwd`.
pub fn check(session: &str, cwd: &str) -> Result<(), Refusal> {
    if !uuid(session) {
        return Err(refuse("session", "the draft names no session that can be resumed"));
    }

    let cwd = Path::new(cwd);

    if !cwd.is_absolute() || !cwd.is_dir() {
        return Err(refuse("elsewhere", "the agent ran on another machine"));
    }

    Ok(())
}

pub fn uuid(value: &str) -> bool {
    let groups: Vec<&str> = value.split('-').collect();

    groups.len() == 5
        && groups.iter().map(|g| g.len()).eq([8, 4, 4, 4, 12])
        && groups.iter().all(|g| g.chars().all(|c| c.is_ascii_hexdigit()))
}

/// Where `claude` is: `$HOME/.local/bin/claude` first, then PATH.
pub fn locate(home: Option<OsString>, path: Option<OsString>) -> Option<PathBuf> {
    let installed = home.map(|home| PathBuf::from(home).join(".local/bin/claude"));

    installed
        .into_iter()
        .chain(path.iter().flat_map(std::env::split_paths).map(|dir| dir.join("claude")))
        .find(|candidate| candidate.is_file())
}

/// The variables set over the app's own. A GUI app's PATH is minimal, so
/// claude's own folder goes first: an npm install finds its `node` there.
pub fn environment(program: &Path, path: Option<OsString>) -> Vec<(OsString, OsString)> {
    let dirs = program.parent().map(PathBuf::from).into_iter().chain(path.iter().flat_map(std::env::split_paths));

    vec![
        ("PATH".into(), std::env::join_paths(dirs).unwrap_or_default()),
        ("TERM".into(), "xterm-256color".into()),
        ("COLORTERM".into(), "truecolor".into()),
    ]
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { cols: cols.max(2), rows: rows.max(2), pixel_width: 0, pixel_height: 0 }
}

fn failed(error: impl std::fmt::Display) -> Refusal {
    Refusal { code: "spawn", message: format!("cannot run claude: {error}") }
}

/// Open a terminal. Its output and exit arrive on `events`.
#[tauri::command]
pub fn terminal_open(
    terminals: State<'_, Terminals>,
    request: Request,
    events: Channel<InvokeResponseBody>,
) -> Result<u32, Refusal> {
    check(&request.session, &request.cwd)?;

    let program = locate(std::env::var_os("HOME"), std::env::var_os("PATH"))
        .ok_or_else(|| refuse("claude", "cannot find claude in ~/.local/bin or on PATH"))?;

    let mut command = CommandBuilder::new(&program);

    command.args(arguments(&request.session));
    command.cwd(&request.cwd);
    for (key, value) in environment(&program, std::env::var_os("PATH")) {
        command.env(key, value);
    }

    let pair = native_pty_system().openpty(size(request.cols, request.rows)).map_err(failed)?;
    let mut child = pair.slave.spawn_command(command).map_err(failed)?;
    let mut reader = pair.master.try_clone_reader().map_err(failed)?;
    let writer = pair.master.take_writer().map_err(failed)?;
    let killer = child.clone_killer();

    let terminals = terminals.inner().clone();
    let id = terminals.1.fetch_add(1, Ordering::Relaxed);

    terminals.0.lock().unwrap().insert(id, Open { master: pair.master, writer, killer });

    thread::spawn(move || {
        let mut buffer = [0u8; 8192];

        while let Ok(read) = reader.read(&mut buffer) {
            if read == 0 || events.send(InvokeResponseBody::Raw(buffer[..read].to_vec())).is_err() {
                break;
            }
        }

        let code = child.wait().ok().map(|status| status.exit_code());

        terminals.0.lock().unwrap().remove(&id);
        let _ = events.send(InvokeResponseBody::Json(format!("{{\"exit\":{}}}", code.map_or("null".into(), |c| c.to_string()))));
    });

    Ok(id)
}

/// Type into a terminal.
#[tauri::command]
pub fn terminal_write(terminals: State<'_, Terminals>, id: u32, data: String) {
    if let Some(open) = terminals.0.lock().unwrap().get_mut(&id) {
        let _ = open.writer.write_all(data.as_bytes());
    }
}

/// Tell a terminal its new size.
#[tauri::command]
pub fn terminal_resize(terminals: State<'_, Terminals>, id: u32, cols: u16, rows: u16) {
    if let Some(open) = terminals.0.lock().unwrap().get(&id) {
        let _ = open.master.resize(size(cols, rows));
    }
}

/// Close a terminal and stop claude. One already gone is not an error.
#[tauri::command]
pub fn terminal_close(terminals: State<'_, Terminals>, id: u32) {
    let open = terminals.0.lock().unwrap().remove(&id);

    if let Some(open) = open {
        close(open);
    }
}

/// Close every terminal, for when the window goes.
pub fn close_all(terminals: &Terminals) {
    let open: Vec<Open> = terminals.0.lock().unwrap().drain().map(|(_, open)| open).collect();

    open.into_iter().for_each(close);
}

// SIGHUP to claude, then SIGKILL if it lingers; its children lose the
// terminal when it, the session leader, exits.
fn close(mut open: Open) {
    let _ = open.killer.kill();
}

#[cfg(test)]
mod tests {
    use super::*;

    const SESSION: &str = "3f2a9c1e-0b4d-4e8a-9f6c-2d1e7b5a8c90";

    fn check_in(cwd: &Path) -> Result<(), Refusal> {
        check(SESSION, &cwd.to_string_lossy())
    }

    #[test]
    fn resumes_the_session_interactively() {
        assert_eq!(arguments(SESSION), ["--resume", SESSION]);
    }

    #[test]
    fn opens_where_the_agents_folder_is_here() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(check_in(dir.path()), Ok(()));
    }

    #[test]
    fn says_another_machine_when_the_agents_folder_is_not_here() {
        assert_eq!(check_in(Path::new("/no/such/folder/anywhere")).unwrap_err().code, "elsewhere");
    }

    #[test]
    fn refuses_a_relative_folder() {
        assert_eq!(check_in(Path::new("repo")).unwrap_err().code, "elsewhere");
    }

    #[test]
    fn refuses_a_session_that_is_not_a_uuid() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(check("--dangerously-skip-permissions", &dir.path().to_string_lossy()).unwrap_err().code, "session");
    }

    #[test]
    fn puts_claudes_own_folder_first_on_path() {
        let env = environment(Path::new("/opt/homebrew/bin/claude"), Some("/usr/bin:/bin".into()));

        assert!(env.contains(&("PATH".into(), "/opt/homebrew/bin:/usr/bin:/bin".into())));
    }

    #[test]
    fn says_what_the_terminal_draws() {
        let env = environment(Path::new("/bin/claude"), None);

        assert!(env.contains(&("TERM".into(), "xterm-256color".into())));
        assert!(env.contains(&("PATH".into(), "/bin".into())));
    }

    #[test]
    fn never_sizes_a_terminal_to_nothing() {
        let shrunk = size(0, 1);

        assert_eq!((shrunk.cols, shrunk.rows), (2, 2));
    }

    #[test]
    fn finds_claude_in_the_home_install_before_path() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();

        std::fs::create_dir_all(home.path().join(".local/bin")).unwrap();
        std::fs::write(home.path().join(".local/bin/claude"), "").unwrap();
        std::fs::write(elsewhere.path().join("claude"), "").unwrap();

        let found = locate(Some(home.path().into()), Some(elsewhere.path().into()));

        assert_eq!(found, Some(home.path().join(".local/bin/claude")));
    }

    #[test]
    fn falls_back_to_path() {
        let home = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();

        std::fs::write(elsewhere.path().join("claude"), "").unwrap();

        let path = std::env::join_paths([Path::new("/no/such/bin"), elsewhere.path()]).unwrap();

        assert_eq!(locate(Some(home.path().into()), Some(path)), Some(elsewhere.path().join("claude")));
        assert_eq!(locate(Some(home.path().into()), None), None);
    }
}
