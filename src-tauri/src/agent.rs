// The agent chat: one `claude -p` run per message the reader sends.
//
// The draft names the session that wrote it and the folder it ran in. Each run
// resumes that session there, streams stdout and stderr back a line at a time,
// and reports the exit. Everything from the draft goes into argv, never into a
// shell string.
//
// Desktop only, for the reason git.rs is: App Sandbox and iOS forbid spawning
// a subprocess. lib.rs compiles this module out under both.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

/// One message to send.
#[derive(Deserialize, Clone)]
pub struct Request {
    pub message: String,
    /// The session to resume: the draft's on a first message, the fork after.
    pub session: String,
    /// True on a chat's first message only.
    pub fork: bool,
    /// The folder the agent ran in.
    pub cwd: String,
    /// The draft's own folder, the one place the agent may write.
    pub folder: String,
}

/// Why a run did not start. `code` is what the frontend branches on.
#[derive(Serialize, Debug, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub message: String,
}

fn refuse(code: &'static str, message: &str) -> Refusal {
    Refusal { code, message: message.to_string() }
}

/// What a run sends back.
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Event {
    Line { text: String },
    Exit { code: Option<i32> },
}

/// The runs in flight, by the id the frontend gave each.
#[derive(Default, Clone)]
pub struct Runs(Arc<Mutex<HashMap<String, Child>>>);

/// The arguments one run passes to `claude`.
pub fn arguments(request: &Request) -> Vec<String> {
    let mut args: Vec<String> = vec!["-p".into(), "--resume".into(), request.session.clone()];

    if request.fork {
        args.push("--fork-session".into());
    }

    args.extend(
        [
            "--output-format",
            "stream-json",
            "--verbose",
            // Nothing may prompt: a headless run has no one to answer.
            "--permission-mode",
            "dontAsk",
            "--allowedTools",
            "Read",
            "Grep",
            "Glob",
            "Bash",
        ]
        .map(String::from),
    );

    // `//` makes the rule an absolute path; Edit rules cover Write too.
    args.push(format!("Edit(/{}/**)", request.folder.trim_end_matches('/')));

    // The message last, behind `--`, so neither a leading dash nor the
    // variadic --allowedTools can take it.
    args.push("--".into());
    args.push(request.message.clone());

    args
}

/// Whether this machine can run the request.
pub fn check(request: &Request) -> Result<(), Refusal> {
    if !uuid(&request.session) {
        return Err(refuse("session", "the draft names no session that can be resumed"));
    }

    let cwd = Path::new(&request.cwd);

    if !cwd.is_absolute() || !cwd.is_dir() {
        return Err(refuse("elsewhere", "the agent ran on another machine"));
    }

    // The folder becomes a permission pattern, so nothing that pattern syntax
    // reads as anything but a path character is let in.
    let folder = Path::new(&request.folder);
    let plain = !request
        .folder
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || "*?[]{}()!,\\".contains(c));

    if !folder.is_absolute() || !plain || !folder.join("review.json").is_file() {
        return Err(refuse("folder", "the draft is not in a folder on this computer the agent can edit"));
    }

    Ok(())
}

fn uuid(value: &str) -> bool {
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

/// Start one run. Lines and the exit arrive on `events`.
#[tauri::command]
pub fn agent_chat_start(
    runs: State<'_, Runs>,
    run: String,
    request: Request,
    events: Channel<Event>,
) -> Result<(), Refusal> {
    check(&request)?;

    let program = locate(std::env::var_os("HOME"), std::env::var_os("PATH"))
        .ok_or_else(|| refuse("claude", "cannot find claude in ~/.local/bin or on PATH"))?;

    let mut command = Command::new(program);

    command
        .args(arguments(&request))
        .current_dir(&request.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Its own process group, so a cancel reaches the tests it started too.
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);

    let mut child = command
        .spawn()
        .map_err(|error| Refusal { code: "spawn", message: format!("cannot run claude: {error}") })?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let runs = runs.inner().clone();

    runs.0.lock().unwrap().insert(run.clone(), child);

    let errors = stderr.map(|stream| {
        let events = events.clone();
        thread::spawn(move || relay(stream, &events))
    });

    thread::spawn(move || {
        if let Some(stream) = stdout {
            relay(stream, &events);
        }
        if let Some(handle) = errors {
            let _ = handle.join();
        }

        let child = runs.0.lock().unwrap().remove(&run);
        let code = child.and_then(|mut child| child.wait().ok()).and_then(|status| status.code());

        let _ = events.send(Event::Exit { code });
    });

    Ok(())
}

fn relay(stream: impl Read, events: &Channel<Event>) {
    for text in BufReader::new(stream).lines().map_while(Result::ok) {
        let _ = events.send(Event::Line { text });
    }
}

/// Stop a run. A run already over is not an error.
#[tauri::command]
pub fn agent_chat_cancel(runs: State<'_, Runs>, run: String) {
    if let Some(child) = runs.0.lock().unwrap().get_mut(&run) {
        stop(child);
    }
}

/// Stop every run, for when the window goes.
pub fn stop_all(runs: &Runs) {
    for child in runs.0.lock().unwrap().values_mut() {
        stop(child);
    }
}

fn stop(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        // The group, not only claude: whatever it spawned goes with it.
        libc::kill(-(child.id() as i32), libc::SIGTERM);
    }

    #[cfg(not(unix))]
    let _ = child.kill();
}

#[cfg(test)]
mod tests {
    use super::*;

    const SESSION: &str = "3f2a9c1e-0b4d-4e8a-9f6c-2d1e7b5a8c90";

    fn request(cwd: &Path, folder: &Path, fork: bool) -> Request {
        Request {
            message: "Is the second finding right?".into(),
            session: SESSION.into(),
            fork,
            cwd: cwd.to_string_lossy().into_owned(),
            folder: folder.to_string_lossy().into_owned(),
        }
    }

    fn draft() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("drafts").join("org--app-42");

        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("review.json"), "{}").unwrap();

        (dir, folder)
    }

    #[test]
    fn forks_the_session_on_the_first_message() {
        let args = arguments(&request(Path::new("/repo"), Path::new("/drafts/org--app-42"), true));

        assert_eq!(&args[..4], ["-p", "--resume", SESSION, "--fork-session"]);
    }

    #[test]
    fn resumes_without_forking_after_that() {
        let args = arguments(&request(Path::new("/repo"), Path::new("/drafts/org--app-42"), false));

        assert_eq!(&args[..3], ["-p", "--resume", SESSION]);
        assert!(!args.contains(&"--fork-session".to_string()));
    }

    #[test]
    fn lets_the_agent_read_anything_run_bash_and_edit_only_its_draft() {
        let args = arguments(&request(Path::new("/repo"), Path::new("/drafts/org--app-42/"), false));
        let at = args.iter().position(|a| a == "--allowedTools").unwrap();

        assert_eq!(&args[at + 1..at + 6], ["Read", "Grep", "Glob", "Bash", "Edit(//drafts/org--app-42/**)"]);
        assert!(!args.iter().any(|a| a.starts_with("Write")));
    }

    #[test]
    fn never_lets_a_permission_prompt_hang_the_run() {
        let args = arguments(&request(Path::new("/repo"), Path::new("/d"), false));
        let at = args.iter().position(|a| a == "--permission-mode").unwrap();

        assert_eq!(args[at + 1], "dontAsk");
    }

    #[test]
    fn streams_json() {
        let args = arguments(&request(Path::new("/repo"), Path::new("/d"), false));
        let at = args.iter().position(|a| a == "--output-format").unwrap();

        assert_eq!(args[at + 1], "stream-json");
        assert!(args.contains(&"--verbose".to_string()));
    }

    #[test]
    fn puts_the_message_last_where_no_flag_can_take_it() {
        let mut asked = request(Path::new("/repo"), Path::new("/d"), false);
        asked.message = "--dangerously-skip-permissions".into();

        let args = arguments(&asked);

        assert_eq!(&args[args.len() - 2..], ["--", "--dangerously-skip-permissions"]);
    }

    #[test]
    fn runs_when_both_folders_are_here() {
        let (dir, folder) = draft();

        assert_eq!(check(&request(dir.path(), &folder, true)), Ok(()));
    }

    #[test]
    fn says_another_machine_when_the_agents_folder_is_not_here() {
        let (_dir, folder) = draft();
        let refused = check(&request(Path::new("/no/such/folder/anywhere"), &folder, true)).unwrap_err();

        assert_eq!(refused.code, "elsewhere");
    }

    #[test]
    fn refuses_a_relative_folder_to_run_in() {
        let (_dir, folder) = draft();

        assert_eq!(check(&request(Path::new("repo"), &folder, true)).unwrap_err().code, "elsewhere");
    }

    #[test]
    fn refuses_a_draft_folder_with_no_draft_in_it() {
        let (dir, _folder) = draft();

        assert_eq!(check(&request(dir.path(), dir.path(), true)).unwrap_err().code, "folder");
    }

    #[test]
    fn refuses_a_draft_folder_that_would_widen_the_edit_rule() {
        let (dir, _) = draft();
        let wide = dir.path().join("dr*fts");

        std::fs::create_dir_all(&wide).unwrap();
        std::fs::write(wide.join("review.json"), "{}").unwrap();

        assert_eq!(check(&request(dir.path(), &wide, true)).unwrap_err().code, "folder");
    }

    #[test]
    fn refuses_a_session_that_is_not_a_uuid() {
        let (dir, folder) = draft();
        let mut asked = request(dir.path(), &folder, true);
        asked.session = "--continue".into();

        assert_eq!(check(&asked).unwrap_err().code, "session");
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
