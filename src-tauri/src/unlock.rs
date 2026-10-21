// When reading a saved secret asks the reader to authenticate, and when it
// must not.
//
// Pure, so it builds and tests on the host. keychain.rs, which is iOS only,
// asks it before every read and write.

/// What this launch knows about the reader's authentication.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lock {
    /// Not asked yet.
    Locked,
    /// Authenticated once; the rest of the launch reads without asking.
    Unlocked,
    /// Cancelled or failed once; reads stop asking for the rest of the launch.
    Refused,
}

/// What a read does next.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Read {
    /// Nothing is saved under that account: answer None, ask nothing.
    Nothing,
    /// Hand the saved secret back.
    Release,
    /// Ask the reader to authenticate first.
    Prompt,
    /// Answer with an error and ask nothing.
    Refuse,
}

/// Whether a read asks, given whether the account holds an item.
///
/// A missing item answers None without a prompt: there is nothing to unlock,
/// and a fresh install (or the sample data) holds no secrets at all. After a
/// cancel, a read refuses rather than asking again. Reads run unprompted by the
/// reader (boot, the health sweep), so asking again would put the sheet back up
/// every time the app looked at a source.
pub fn read(saved: bool, lock: Lock) -> Read {
    match (saved, lock) {
        (false, _) => Read::Nothing,
        (true, Lock::Unlocked) => Read::Release,
        (true, Lock::Locked) => Read::Prompt,
        (true, Lock::Refused) => Read::Refuse,
    }
}

/// Whether saving a secret asks first.
///
/// A save only happens when the reader submits a credential, so it asks even
/// after a cancel: that tap is the reader asking to try again.
pub fn write_prompts(lock: Lock) -> bool {
    lock != Lock::Unlocked
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_saved_never_prompts() {
        for lock in [Lock::Locked, Lock::Unlocked, Lock::Refused] {
            assert_eq!(read(false, lock), Read::Nothing, "{lock:?}");
        }
    }

    #[test]
    fn a_saved_secret_prompts_once_per_launch() {
        assert_eq!(read(true, Lock::Locked), Read::Prompt);
        assert_eq!(read(true, Lock::Unlocked), Read::Release);
    }

    #[test]
    fn a_cancel_is_not_asked_again_by_a_read() {
        assert_eq!(read(true, Lock::Refused), Read::Refuse);
    }

    #[test]
    fn saving_asks_unless_unlocked_even_after_a_cancel() {
        assert!(write_prompts(Lock::Locked));
        assert!(write_prompts(Lock::Refused));
        assert!(!write_prompts(Lock::Unlocked));
    }
}
