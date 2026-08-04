// The native reader, scoped to one folder.
//
// Every path that arrives here came out of a draft file written by an agent
// that reads other people's branches, so containment is a security boundary
// rather than tidiness. Each command takes the chosen root and a relative path,
// and refuses anything that resolves outside that root - including by symlink,
// which is the case a string comparison alone would wave through.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
#[cfg(not(target_os = "ios"))]
use tauri::Manager;
#[cfg(not(target_os = "ios"))]
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_dialog::FilePath;

/// One file in a listing. Times and sizes are already in the units the reader
/// wants - milliseconds since the epoch - so nothing has to be converted twice.
#[derive(Serialize)]
pub struct Entry {
    pub path: String,
    pub size: u64,
    pub modified_at: i64,
}

/// Ask for the folder to work in, and widen the asset protocol to match.
///
/// The dialog runs here rather than in the frontend, which is why the app ships
/// no dialog permission at all. Allowing the directory afterwards is what lets
/// `convertFileSrc` stream a video out of it without the bytes crossing the IPC
/// boundary; the scope cannot be set at build time because the folder is the
/// customer's choice.
///
/// Closing the dialog is the reader changing their mind, so it answers with
/// nothing. Everything else that can go wrong here is a failure, and says so:
/// answering nothing to all of it left the interface telling the reader they
/// had not chosen a folder, which is the one thing that had not happened.
///
/// Desktop only: `pick_folder` is not part of the dialog plugin's mobile
/// surface at all, because iOS has no lasting concept of "an arbitrary folder
/// the app may return to" the way a desktop filesystem does. A folder as a
/// draft source is a desktop-only offering for the same reason the git
/// transport in git.rs is - see the comment there.
#[cfg(not(target_os = "ios"))]
#[tauri::command]
pub async fn storage_pick_root(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (send, mut receive) = tauri::async_runtime::channel(1);

    app.dialog().file().pick_folder(move |folder| {
        // Capacity is one and this fires once, so the send cannot block. A send
        // that could not land drops the sender, which the receiver reads as the
        // dialog never having answered.
        let _ = send.blocking_send(folder);
    });

    let Some(path) = picked(receive.recv().await)? else {
        return Ok(None);
    };

    // Widening the scope is what lets `convertFileSrc` stream a recording out of
    // this folder. Carrying on without it would hand back a folder that works
    // for everything except the videos, and the reader would meet that hours
    // later as a player that shows nothing and says nothing.
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|error| {
            format!(
                "{} cannot be opened for playback, so recordings in it would \
                 not play: {error}. Choose a different folder.",
                path.display()
            )
        })?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

/// What the dialog answered, with the one dismissal told apart from the rest.
///
/// The outer `None` is the channel closing empty, which means the callback was
/// dropped and the dialog never answered at all. The inner `None` is the reader
/// closing it, which is the only case here that is not a failure. A choice that
/// is not a path on this disk is a URI the platform handed back, and nothing
/// under this root can read one.
fn picked(answer: Option<Option<FilePath>>) -> Result<Option<PathBuf>, String> {
    let Some(answer) = answer else {
        return Err("the folder dialog closed without answering".to_string());
    };

    let Some(chosen) = answer else {
        return Ok(None);
    };

    chosen
        .into_path()
        .map(Some)
        .map_err(|error| format!("that folder is not a path on this disk: {error}"))
}

/// List the files under a prefix, recursively.
///
/// Directories are not entries in their own right, and symlinks are skipped
/// rather than followed: a link is either a way out of the root or a way to
/// walk the same subtree forever.
#[tauri::command]
pub fn storage_list(root: String, prefix: String) -> Result<Vec<Entry>, String> {
    let root = canonical_root(&root)?;

    // Walking only the branch the prefix names, so a large root is not read in
    // full to answer a question about one folder.
    let branch = match prefix.rfind('/') {
        Some(cut) => &prefix[..cut],
        None => "",
    };

    let start = resolve(&root, branch)?;

    if !start.is_dir() {
        return Ok(Vec::new());
    }

    let mut found = Vec::new();
    walk(&root, &start, &mut found)?;

    found.retain(|entry| entry.path.starts_with(&prefix));
    Ok(found)
}

/// Read a file whole.
///
/// A missing file is nothing, not a failure. The reader asks for paths a
/// listing mentioned moments ago, and a draft deleted in between is ordinary.
#[tauri::command]
pub fn storage_read(root: String, path: String) -> Result<Option<Vec<u8>>, String> {
    let root = canonical_root(&root)?;
    let target = resolve(&root, &path)?;

    match fs::symlink_metadata(&target) {
        Ok(meta) if meta.is_file() => {
            fs::read(&target).map(Some).map_err(|error| error.to_string())
        }
        _ => Ok(None),
    }
}

/// Write a file, creating the folders above it.
///
/// The write lands as a rename over a temp file in the same directory, so a
/// reader polling this folder sees either the old bytes or the new ones. A
/// half-written draft parsed as JSON would look like a corrupt draft rather
/// than an in-progress one.
#[tauri::command]
pub fn storage_write(root: String, path: String, bytes: Vec<u8>) -> Result<(), String> {
    let root = canonical_root(&root)?;
    let target = resolve(&root, &path)?;

    let parent = target
        .parent()
        .ok_or_else(|| outside(&path))?
        .to_path_buf();

    fs::create_dir_all(&parent).map_err(|error| error.to_string())?;

    let temp = parent.join(temp_name(&target));

    let written = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(&bytes)?;
        // Renaming over a file whose contents are still in a buffer would
        // survive the process but not the machine losing power.
        file.sync_all()?;
        fs::rename(&temp, &target)
    })();

    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }

    written.map_err(|error| error.to_string())
}

/// Delete a file. Already gone counts as done.
#[tauri::command]
pub fn storage_remove(root: String, path: String) -> Result<(), String> {
    let root = canonical_root(&root)?;
    let target = resolve(&root, &path)?;

    match fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn outside(path: &str) -> String {
    format!("path is outside the workspace: {path}")
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    if root.is_empty() {
        return Err("no folder has been chosen".to_string());
    }

    fs::canonicalize(root).map_err(|error| format!("cannot reach the folder: {error}"))
}

/// Turn a relative path into an absolute one that is provably inside the root.
///
/// Two passes. The first rejects the shapes that are wrong on their face -
/// absolute, home-relative, drive-lettered, or climbing. The second walks the
/// path a component at a time and resolves any symlink it meets, because a link
/// inside the root can still name a file outside it, and the textual pass
/// cannot see that. Components that do not exist yet are left alone: there is
/// nothing there to point anywhere.
fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.starts_with('/')
        || relative.starts_with('\\')
        || relative.starts_with('~')
        || drive_prefixed(relative)
    {
        return Err(outside(relative));
    }

    if relative
        .split(['/', '\\'])
        .any(|part| part == ".." || drive_prefixed(part))
    {
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

fn temp_name(target: &Path) -> String {
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_nanos())
        .unwrap_or(0);

    format!(".{name}.{}.{stamp}.tmp", std::process::id())
}

fn walk(root: &Path, dir: &Path, found: &mut Vec<Entry>) -> Result<(), String> {
    let listing = fs::read_dir(dir).map_err(|error| error.to_string())?;

    for entry in listing {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };

        if meta.file_type().is_symlink() {
            continue;
        }

        if meta.is_dir() {
            walk(root, &path, found)?;
            continue;
        }

        if !meta.is_file() {
            continue;
        }

        let relative = match path.strip_prefix(root) {
            Ok(relative) => relative.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        found.push(Entry {
            path: relative,
            size: meta.len(),
            modified_at: millis(meta.modified().ok()),
        });
    }

    Ok(())
}

fn millis(time: Option<SystemTime>) -> i64 {
    time.and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temp dir")
    }

    fn canonical(dir: &tempfile::TempDir) -> PathBuf {
        fs::canonicalize(dir.path()).expect("a canonical root")
    }

    #[test]
    fn keeps_a_plain_relative_path_inside_the_root() {
        let dir = root();
        let base = canonical(&dir);

        let resolved = resolve(&base, "drafts/org--app-1/review.json").expect("contained");

        assert_eq!(resolved, base.join("drafts/org--app-1/review.json"));
    }

    #[test]
    fn refuses_an_absolute_path() {
        let dir = root();
        let base = canonical(&dir);

        assert!(resolve(&base, "/etc/passwd").is_err());
    }

    #[test]
    fn refuses_a_climbing_path() {
        let dir = root();
        let base = canonical(&dir);

        assert!(resolve(&base, "../secrets").is_err());
        assert!(resolve(&base, "drafts/../../secrets").is_err());
    }

    #[test]
    fn refuses_a_home_relative_path() {
        let dir = root();
        let base = canonical(&dir);

        assert!(resolve(&base, "~/.ssh/id_rsa").is_err());
    }

    #[test]
    fn refuses_a_windows_drive_prefix() {
        let dir = root();
        let base = canonical(&dir);

        assert!(resolve(&base, "C:/Windows/System32/config/SAM").is_err());
        assert!(resolve(&base, "drafts/C:evil").is_err());
    }

    #[test]
    fn refuses_a_backslash_climb() {
        let dir = root();
        let base = canonical(&dir);

        assert!(resolve(&base, "drafts\\..\\..\\secrets").is_err());
        assert!(resolve(&base, "\\\\server\\share").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_that_leaves_the_root() {
        let dir = root();
        let base = canonical(&dir);
        let elsewhere = root();
        let secret = canonical(&elsewhere).join("secret.txt");
        fs::write(&secret, b"private").expect("a file outside");

        std::os::unix::fs::symlink(&secret, base.join("escape.txt")).expect("a symlink");

        assert!(resolve(&base, "escape.txt").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_path_through_a_directory_symlink_that_leaves_the_root() {
        let dir = root();
        let base = canonical(&dir);
        let elsewhere = root();

        std::os::unix::fs::symlink(canonical(&elsewhere), base.join("out")).expect("a symlink");

        assert!(resolve(&base, "out/secret.txt").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_broken_symlink_rather_than_writing_through_it() {
        let dir = root();
        let base = canonical(&dir);
        let elsewhere = root();
        let missing = canonical(&elsewhere).join("not-here.txt");

        std::os::unix::fs::symlink(&missing, base.join("dangling.txt")).expect("a symlink");

        assert!(resolve(&base, "dangling.txt").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn allows_a_symlink_that_stays_inside_the_root() {
        let dir = root();
        let base = canonical(&dir);
        fs::create_dir(base.join("real")).expect("a dir");
        fs::write(base.join("real/review.json"), b"{}").expect("a file");

        std::os::unix::fs::symlink(base.join("real"), base.join("linked")).expect("a symlink");

        let resolved = resolve(&base, "linked/review.json").expect("contained");

        assert_eq!(resolved, base.join("real/review.json"));
    }

    #[test]
    fn a_dismissed_dialog_is_nothing_chosen_rather_than_a_failure() {
        assert_eq!(picked(Some(None)), Ok(None));
    }

    #[test]
    fn a_dialog_that_never_answered_is_a_failure_rather_than_a_dismissal() {
        assert!(picked(None).is_err());
    }

    #[test]
    fn a_chosen_folder_is_the_path_it_names() {
        let dir = root();
        let path = dir.path().to_path_buf();

        assert_eq!(picked(Some(Some(FilePath::from(path.clone())))), Ok(Some(path)));
    }

    #[test]
    fn a_choice_that_is_not_a_path_on_this_disk_is_a_failure() {
        let uri: FilePath = "content://com.android.documents/tree/1".parse().expect("a uri");

        assert!(picked(Some(Some(uri))).is_err());
    }

    #[test]
    fn writes_and_reads_back() {
        let dir = root();
        let base = dir.path().to_string_lossy().into_owned();

        storage_write(base.clone(), "drafts/a.json".into(), b"{}".to_vec()).expect("written");

        let read = storage_read(base, "drafts/a.json".into()).expect("read");

        assert_eq!(read, Some(b"{}".to_vec()));
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let dir = root();
        let base = dir.path().to_string_lossy().into_owned();

        storage_write(base.clone(), "a.json".into(), b"{}".to_vec()).expect("written");

        let listed = storage_list(base, String::new()).expect("listed");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, "a.json");
        assert_eq!(listed[0].size, 2);
    }

    #[test]
    fn reads_a_missing_file_as_nothing() {
        let dir = root();
        let base = dir.path().to_string_lossy().into_owned();

        assert_eq!(storage_read(base, "nothing.json".into()).expect("read"), None);
    }

    #[test]
    fn removing_what_is_not_there_is_not_an_error() {
        let dir = root();
        let base = dir.path().to_string_lossy().into_owned();

        assert!(storage_remove(base, "nothing.json".into()).is_ok());
    }

    #[test]
    fn lists_only_what_is_under_the_prefix() {
        let dir = root();
        let base = dir.path().to_string_lossy().into_owned();

        storage_write(base.clone(), "drafts/one/review.json".into(), b"{}".to_vec()).unwrap();
        storage_write(base.clone(), "events/device.jsonl".into(), b"".to_vec()).unwrap();

        let listed = storage_list(base, "drafts/".into()).expect("listed");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, "drafts/one/review.json");
    }

    #[test]
    fn refuses_to_write_outside_the_root() {
        let dir = root();
        let base = dir.path().to_string_lossy().into_owned();

        assert!(storage_write(base, "../escaped.json".into(), b"x".to_vec()).is_err());
    }
}
