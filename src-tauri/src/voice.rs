// Talking to the agent by voice: the page hears the reader, asks the
// draft's session one question with `claude -p --resume`, and speaks the
// reply aloud.
//
// Desktop only, for the reason terminal.rs is: it spawns subprocesses.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};

use crate::terminal::{self, refuse, Refusal};

/// One spoken question to a session.
#[derive(Deserialize)]
pub struct AskRequest {
    pub session: String,
    /// The folder the agent ran in.
    pub cwd: String,
    pub words: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Answer {
    pub reply: String,
    pub session: String,
}

/// The warm speaker, if one runs, and the process groups of questions asked.
#[derive(Default, Clone)]
pub struct Voice(Arc<Mutex<Option<Warm>>>, Arc<Mutex<Vec<u32>>>);

struct Warm {
    group: u32,
    child: Child,
    stdin: ChildStdin,
    lines: Arc<Mutex<BufReader<ChildStdout>>>,
    speaking: bool,
}

const SPEAKER: &str = include_str!("speaker.py");

// The fallback speaker, with speaker.py's protocol. Like speaker.py, it kills
// its own group when the app goes.
const SAY: &str = "(while kill -0 $PPID 2>/dev/null; do sleep 0.5; done; kill -TERM 0) & \
while IFS= read -r line; do printf '%s' \"$line\" | /usr/bin/say -f -; echo done; done";

pub const SPOKEN: &str = "The reader is talking to you by voice about this pull request. \
Your reply is read aloud. Answer in a few short spoken sentences. \
No markdown, code blocks, file paths or lists unless asked.";

/// The words go on stdin, never here: a phrase starting with "-" would be a flag.
pub fn ask_arguments(session: &str) -> Vec<String> {
    ["-p", "--resume", session, "--output-format", "json", "--append-system-prompt", SPOKEN].map(String::from).to_vec()
}

#[derive(Deserialize)]
struct Printed {
    #[serde(default)]
    is_error: bool,
    #[serde(default)]
    result: String,
    #[serde(default)]
    session_id: String,
}

pub fn answer_from(stdout: &str, stderr: &str) -> Result<Answer, Refusal> {
    match serde_json::from_str::<Printed>(stdout) {
        Ok(printed) if !printed.is_error => Ok(Answer { reply: printed.result, session: printed.session_id }),
        Ok(printed) => Err(refuse("ask", &format!("claude could not answer: {}", printed.result.trim()))),
        Err(_) => Err(refuse("ask", &format!("claude could not answer: {}", stderr.trim()))),
    }
}

fn ask(voice: &Voice, request: AskRequest) -> Result<Answer, Refusal> {
    if request.words.trim().is_empty() {
        return Err(refuse("words", "nothing was said"));
    }

    terminal::check(&request.session, &request.cwd)?;

    let program = terminal::locate(std::env::var_os("HOME"), std::env::var_os("PATH"))
        .ok_or_else(|| refuse("claude", "cannot find claude in ~/.local/bin or on PATH"))?;

    let output = run(
        voice,
        Command::new(&program)
            .args(ask_arguments(&request.session))
            .current_dir(&request.cwd)
            .envs(terminal::environment(&program, std::env::var_os("PATH"))),
        &request.words,
    )?;

    answer_from(&String::from_utf8_lossy(&output.stdout), &String::from_utf8_lossy(&output.stderr))
}

// Runs `command` in its own group with `input` on stdin, until it ends or is hushed.
fn run(voice: &Voice, command: &mut Command, input: &str) -> Result<Output, Refusal> {
    let failed = |e: std::io::Error| refuse("spawn", &format!("cannot run claude: {e}"));
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(failed)?;
    let group = child.id();

    voice.1.lock().unwrap().push(group);
    let _ = child.stdin.take().unwrap().write_all(input.as_bytes());

    let output = child.wait_with_output();
    let mut asking = voice.1.lock().unwrap();
    let at = asking.iter().position(|&g| g == group).ok_or_else(|| refuse("hushed", "the question was hushed"))?;

    asking.remove(at);
    output.map_err(failed)
}

/// Kokoro, kept warm, when its venv and model are there; else macOS `say`.
pub fn speaker(home: Option<OsString>, exists: impl Fn(&Path) -> bool) -> (PathBuf, Vec<String>) {
    let dir = home.map(|home| PathBuf::from(home).join("apps/com/www.epiccreekadventures.com"));

    match dir {
        Some(dir)
            if ["venv/bin/python", "kokoro-v1.0.onnx", "voices-v1.0.bin"].iter().all(|f| exists(&dir.join(f))) =>
        {
            let python = dir.join("venv/bin/python");

            (python, vec!["-u".into(), "-c".into(), SPEAKER.into(), dir.to_string_lossy().into_owned()])
        }
        _ => ("/bin/sh".into(), vec!["-c".into(), SAY.into()]),
    }
}

/// One stdin line for the speaker: the sentences, split by tabs.
pub fn utterance(text: &str) -> String {
    let mut sentences = vec![String::new()];

    for c in text.chars() {
        let last = sentences.last_mut().unwrap();

        // Markdown is never read aloud; an underscore joins words.
        if matches!(c, '*' | '`' | '#') {
            continue;
        }
        let c = if c == '_' { ' ' } else { c };

        if c.is_whitespace() {
            if last.ends_with(['.', '!', '?']) || c == '\n' {
                sentences.push(String::new());
            } else if !last.is_empty() && !last.ends_with(' ') {
                last.push(' ');
            }
        } else {
            last.push(c);
        }
    }

    let sentences: Vec<&str> = sentences.iter().map(|s| s.trim()).filter(|s| !s.is_empty()).collect();

    format!("{}\n", sentences.join("\t"))
}

fn spawn(program: &Path, arguments: &[String]) -> Result<Warm, Refusal> {
    let mut child = Command::new(program)
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|e| refuse("say", &format!("cannot speak: {e}")))?;

    Ok(Warm {
        group: child.id(),
        stdin: child.stdin.take().unwrap(),
        lines: Arc::new(Mutex::new(BufReader::new(child.stdout.take().unwrap()))),
        child,
        speaking: false,
    })
}

// Says `text` on the warm speaker, starting one from `program` when none runs.
// A say already speaking is hushed; a hushed say resolves Ok.
fn say(voice: &Voice, program: &Path, arguments: &[String], text: &str) -> Result<(), Refusal> {
    let line = utterance(text);
    let stopped = || refuse("say", "the speaker stopped");

    let (group, lines) = {
        let mut warm = voice.0.lock().unwrap();

        if warm.as_ref().is_some_and(|w| w.speaking) {
            stop(warm.take());
        }
        if line == "\n" {
            return Ok(());
        }
        if warm.is_none() {
            *warm = Some(spawn(program, arguments)?);
        }

        let w = warm.as_mut().unwrap();

        if w.stdin.write_all(line.as_bytes()).is_err() {
            stop(warm.take());
            return Err(stopped());
        }
        w.speaking = true;

        (w.group, w.lines.clone())
    };

    let mut heard = String::new();
    let _ = lines.lock().unwrap().read_line(&mut heard);
    let mut warm = voice.0.lock().unwrap();

    match warm.as_mut() {
        Some(w) if w.group == group && heard == "done\n" => {
            w.speaking = false;
            Ok(())
        }
        Some(w) if w.group == group => {
            stop(warm.take());
            Err(stopped())
        }
        _ => Ok(()),
    }
}

/// Stop the speaker (python and its afplay child alike) and every question
/// asked. The next say starts another speaker.
pub fn hush(voice: &Voice) {
    stop(voice.0.lock().unwrap().take());
    voice.1.lock().unwrap().drain(..).for_each(kill);
}

fn stop(warm: Option<Warm>) {
    if let Some(mut warm) = warm {
        kill(warm.group);
        thread::spawn(move || warm.child.wait());
    }
}

fn kill(group: u32) {
    let _ = Command::new("/bin/kill").args(["-TERM", "--", &format!("-{group}")]).status();
}

fn joined(error: impl std::fmt::Display) -> Refusal {
    refuse("spawn", &error.to_string())
}

/// Ask the draft's session one spoken question.
#[tauri::command]
pub async fn voice_ask(voice: tauri::State<'_, Voice>, request: AskRequest) -> Result<Answer, Refusal> {
    let voice = voice.inner().clone();

    tauri::async_runtime::spawn_blocking(move || ask(&voice, request)).await.map_err(joined)?
}

/// Speak `text`, resolving when it ends or is hushed. A new say hushes the old.
#[tauri::command]
pub async fn voice_say(voice: tauri::State<'_, Voice>, text: String) -> Result<(), Refusal> {
    let voice = voice.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        let (program, arguments) = speaker(std::env::var_os("HOME"), Path::is_file);

        say(&voice, &program, &arguments, &text)
    })
    .await
    .map_err(joined)?
}

#[tauri::command]
pub fn voice_hush(voice: tauri::State<'_, Voice>) {
    hush(&voice);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    const SESSION: &str = "3f2a9c1e-0b4d-4e8a-9f6c-2d1e7b5a8c90";

    #[test]
    fn asks_the_session_once_in_json_with_spoken_instructions() {
        assert_eq!(
            ask_arguments(SESSION),
            ["-p", "--resume", SESSION, "--output-format", "json", "--append-system-prompt", SPOKEN]
        );
    }

    #[test]
    fn reads_the_reply_and_session() {
        let stdout = r#"{"type":"result","is_error":false,"result":"It adds a cache.","session_id":"abc"}"#;

        assert_eq!(answer_from(stdout, ""), Ok(Answer { reply: "It adds a cache.".into(), session: "abc".into() }));
    }

    #[test]
    fn refuses_an_error_with_claudes_words() {
        let stdout = r#"{"is_error":true,"result":"Session not found","session_id":"abc"}"#;
        let refusal = answer_from(stdout, "").unwrap_err();

        assert_eq!(refusal.code, "ask");
        assert!(refusal.message.contains("Session not found"));
    }

    #[test]
    fn refuses_unreadable_output_with_stderr() {
        let refusal = answer_from("", "No conversation found").unwrap_err();

        assert_eq!(refusal.code, "ask");
        assert!(refusal.message.contains("No conversation found"));
    }

    #[test]
    fn refuses_empty_words() {
        let dir = tempfile::tempdir().unwrap();
        let request =
            AskRequest { session: SESSION.into(), cwd: dir.path().to_string_lossy().into_owned(), words: " \n ".into() };

        assert_eq!(ask(&Voice::default(), request).unwrap_err().code, "words");
    }

    #[test]
    fn refuses_a_session_that_is_not_a_uuid() {
        let request = AskRequest { session: "-x".into(), cwd: "/".into(), words: "hi".into() };

        assert_eq!(ask(&Voice::default(), request).unwrap_err().code, "session");
    }

    fn sh(script: &str) -> (PathBuf, Vec<String>) {
        ("/bin/sh".into(), vec!["-c".into(), script.into()])
    }

    fn saying(voice: &Voice, script: &str, text: &str) -> thread::JoinHandle<Result<(), Refusal>> {
        let (voice, (program, arguments), text) = (voice.clone(), sh(script), text.to_string());

        thread::spawn(move || say(&voice, &program, &arguments, &text))
    }

    fn until(started: Instant, done: impl Fn() -> bool) {
        while !done() {
            assert!(started.elapsed() < Duration::from_secs(5), "timed out");
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn speaking(voice: &Voice) -> bool {
        voice.0.lock().unwrap().as_ref().is_some_and(|w| w.speaking)
    }

    const SLOW: &str = "while read -r l; do sleep 30; echo done; done";

    #[test]
    fn keeps_kokoro_warm_when_it_is_installed() {
        let (program, arguments) = speaker(Some("/Users/me".into()), |_| true);

        assert_eq!(program, Path::new("/Users/me/apps/com/www.epiccreekadventures.com/venv/bin/python"));
        assert_eq!(arguments[..2], ["-u", "-c"]);
        assert!(arguments[2].contains("kokoro.create"));
        assert_eq!(arguments[3], "/Users/me/apps/com/www.epiccreekadventures.com");
    }

    #[test]
    fn falls_back_to_say_without_the_model() {
        let no_model = |p: &Path| !p.ends_with("kokoro-v1.0.onnx");

        assert_eq!(speaker(Some("/Users/me".into()), no_model), sh(SAY));
        assert_eq!(speaker(None, |_| true), sh(SAY));
    }

    #[test]
    fn splits_the_text_into_sentences() {
        assert_eq!(utterance("It adds a cache.  Why? Speed!\nThen\ttests"), "It adds a cache.\tWhy?\tSpeed!\tThen tests\n");
        assert_eq!(utterance("v1.2 ships"), "v1.2 ships\n");
        assert_eq!(utterance(" \n "), "\n");
    }

    #[test]
    fn never_reads_markdown_aloud() {
        assert_eq!(utterance("**Yes.** The `user_id` column has # no index."), "Yes.\tThe user id column has no index.\n");
    }

    #[test]
    fn says_on_one_warm_speaker() {
        let dir = tempfile::tempdir().unwrap();
        let heard = dir.path().join("heard");
        let script = format!("while IFS= read -r l; do printf '%s|' \"$l\" >> '{}'; echo done; done", heard.display());
        let voice = Voice::default();
        let (program, arguments) = sh(&script);

        say(&voice, &program, &arguments, "One. Two").unwrap();
        let group = voice.0.lock().unwrap().as_ref().unwrap().group;
        say(&voice, &program, &arguments, "-n three").unwrap();

        assert_eq!(std::fs::read_to_string(heard).unwrap(), "One.\tTwo|-n three|");
        assert_eq!(voice.0.lock().unwrap().as_ref().unwrap().group, group);
        hush(&voice);
    }

    #[test]
    fn hushing_ends_the_speech_without_error() {
        let voice = Voice::default();
        let started = Instant::now();
        let said = saying(&voice, SLOW, "Hello.");

        until(started, || speaking(&voice));
        hush(&voice);
        until(started, || said.is_finished());

        assert_eq!(said.join().unwrap(), Ok(()));
        assert!(voice.0.lock().unwrap().is_none());
    }

    #[test]
    fn a_new_say_hushes_the_old() {
        let voice = Voice::default();
        let started = Instant::now();
        let first = saying(&voice, SLOW, "First.");

        until(started, || speaking(&voice));
        let second = saying(&voice, "while read -r l; do echo done; done", "Second.");
        until(started, || first.is_finished() && second.is_finished());

        assert_eq!(first.join().unwrap(), Ok(()));
        assert_eq!(second.join().unwrap(), Ok(()));
        hush(&voice);
    }

    #[test]
    fn refuses_when_the_speaker_dies_and_starts_another_next_time() {
        let voice = Voice::default();
        let (program, arguments) = sh("read -r l; exit 3");

        assert_eq!(say(&voice, &program, &arguments, "Hi.").unwrap_err().code, "say");
        assert!(voice.0.lock().unwrap().is_none());

        let (program, arguments) = sh("while read -r l; do echo done; done");

        assert_eq!(say(&voice, &program, &arguments, "Hi."), Ok(()));
        hush(&voice);
    }

    #[test]
    fn asks_in_its_own_group_and_returns_the_output() {
        let voice = Voice::default();
        let output = run(&voice, Command::new("/bin/sh").args(["-c", "cat"]), "-n hi").unwrap();

        assert_eq!(output.stdout, b"-n hi");
        assert!(voice.1.lock().unwrap().is_empty());
    }

    #[test]
    fn hushing_cancels_a_question() {
        let voice = Voice::default();
        let started = Instant::now();
        let asking = voice.clone();
        let asked = thread::spawn(move || run(&asking, Command::new("/bin/sh").args(["-c", "sleep 30 & wait"]), ""));

        until(started, || !voice.1.lock().unwrap().is_empty());
        hush(&voice);
        until(started, || asked.is_finished());

        assert_eq!(asked.join().unwrap().unwrap_err().code, "hushed");
    }

    // A stand-in app runs the fallback speaker, then is killed outright.
    #[test]
    fn the_say_fallback_dies_with_the_app() {
        let started = Instant::now();
        let mut app = Command::new("/bin/sh")
            .args(["-c", "/bin/sh -c \"$1\" <&0 & echo $!; sleep 30", "app", SAY])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .process_group(0)
            .spawn()
            .unwrap();
        let _open = app.stdin.take(); // wait() would close it, ending the loop
        let mut pid = String::new();

        BufReader::new(app.stdout.take().unwrap()).read_line(&mut pid).unwrap();
        app.kill().unwrap();
        app.wait().unwrap();

        let alive = || Command::new("/bin/kill").args(["-0", pid.trim()]).stderr(Stdio::null()).status().unwrap().success();

        until(started, || !alive());
    }

    #[test]
    fn hushing_silence_does_nothing() {
        hush(&Voice::default());
    }
}
