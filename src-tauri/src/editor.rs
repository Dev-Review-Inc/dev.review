// Opening a review's folder in the reader's editor.
//
// `open -a` rather than each editor's URL scheme, because Sublime Text has
// none. The editor is picked from a fixed list, never named by the frontend,
// and the folder is one argv entry, never a shell string.
//
// macOS desktop only: App Sandbox and iOS forbid spawning `open`. lib.rs
// compiles this module out under both.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

/// The editors offered: the key the frontend sends, the label it shows, and
/// the application bundle `open -a` is given.
const EDITORS: &[(&str, &str, &str)] = &[
    ("zed", "Zed", "Zed"),
    ("sublime", "Sublime", "Sublime Text"),
    ("vscode", "VS Code", "Visual Studio Code"),
    ("cursor", "Cursor", "Cursor"),
];

#[derive(Serialize, Debug, PartialEq)]
pub struct Editor {
    pub key: &'static str,
    pub label: &'static str,
}

/// The editors whose application is in /Applications or ~/Applications.
fn installed(home: Option<&Path>) -> Vec<Editor> {
    EDITORS
        .iter()
        .filter(|(_, _, app)| {
            let bundle = format!("{app}.app");

            Path::new("/Applications").join(&bundle).exists()
                || home.is_some_and(|home| home.join("Applications").join(&bundle).exists())
        })
        .map(|&(key, label, _)| Editor { key, label })
        .collect()
}

/// The arguments to `open` for one editor and one folder.
fn arguments(editor: &str, folder: &str) -> Result<Vec<String>, String> {
    let (_, _, app) = EDITORS
        .iter()
        .find(|(key, _, _)| *key == editor)
        .ok_or_else(|| format!("{editor} is not an editor this app opens"))?;

    let path = Path::new(folder);

    if !path.is_absolute() || !path.is_dir() {
        return Err(format!("{folder} is not a folder on this computer"));
    }

    Ok(vec!["-a".into(), (*app).into(), folder.into()])
}

#[tauri::command]
pub fn editors_installed() -> Vec<Editor> {
    installed(std::env::var_os("HOME").as_deref().map(Path::new))
}

#[tauri::command]
pub fn editor_open(editor: String, folder: String) -> Result<(), String> {
    let status = Command::new("open")
        .args(arguments(&editor, &folder)?)
        .status()
        .map_err(|failure| failure.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("macOS could not open {folder} in {editor}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_a_known_editor_on_an_absolute_folder() {
        let folder = std::env::temp_dir();
        let folder = folder.to_str().unwrap();

        assert_eq!(
            arguments("sublime", folder),
            Ok(vec!["-a".to_string(), "Sublime Text".to_string(), folder.to_string()])
        );
    }

    #[test]
    fn refuses_an_editor_not_on_the_list() {
        assert!(arguments("Terminal", "/tmp").is_err());
    }

    #[test]
    fn refuses_a_relative_or_missing_folder() {
        assert!(arguments("zed", "tmp").is_err());
        assert!(arguments("zed", "/no/such/folder/here").is_err());
    }

    #[test]
    fn offers_only_editors_that_are_installed() {
        let home = std::env::temp_dir().join(format!("editors-{}", std::process::id()));
        std::fs::create_dir_all(home.join("Applications/Cursor.app")).unwrap();

        let found = installed(Some(&home));

        std::fs::remove_dir_all(&home).unwrap();
        assert!(found.contains(&Editor { key: "cursor", label: "Cursor" }));
    }
}
