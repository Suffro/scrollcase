//! Shell-free execution of a box this process has already verified.
//!
//! The verified release supplies the interpreter and the script or module identity; the caller
//! supplies only additional argument strings, streams, and environment values. Nothing is passed
//! through a shell, and the argument vector is built from signed metadata rather than from a command
//! string, so there is no point at which a name from a manifest could become a second command.
//!
//! **Signals are forwarded through a channel the caller owns, not through handlers this crate
//! installs.** A library that registered a process-wide `SIGINT` handler would silently displace the
//! handler of the application embedding it — in a desktop app that is a bug, not a feature. So the
//! seam is explicit: a caller that wants forwarding wires its own handler to a [`SignalSender`], and
//! a caller that does not gets a child that simply runs. The Node consumer takes the same shape
//! through an injectable `signalSource`; here the injection is the only form.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

use crate::environment::{
    resolve_environment, EnvironmentLayer, EnvironmentReport, EnvironmentSource, ResolveOptions,
};
use crate::error::{fail, Error, Result};
use crate::execution::assert_execution_files;
use crate::filesystem::collect_files;
use crate::path::{join_relative, safe_relative_path};
use crate::prepare::{
    verify_and_extract_box, verify_required_assets, EnvironmentReportOptions, PrepareOptions,
    PreparedBox,
};
use crate::release::Execution;
use crate::trust::TrustAnchors;

/// What would be spawned, once the trust chain has finished and the environment is resolved.
///
/// This exists so the decision to spawn and the act of spawning are separable. A test can then assert
/// the exact argument vector, working directory and environment a box would run with — including
/// that no shell is involved — without a process ever starting.
pub struct BoxInvocation<'a> {
    /// The box's own interpreter.
    pub program: &'a Path,
    /// Arguments, in the order the release and the caller fixed.
    pub args: &'a [String],
    /// The working directory, always the box root.
    pub cwd: &'a Path,
    /// The complete environment the child receives.
    pub environment: &'a std::collections::BTreeMap<String, String>,
    /// Where standard input comes from.
    pub stdin: StdioMode,
    /// Where standard output goes.
    pub stdout: StdioMode,
    /// Where standard error goes.
    pub stderr: StdioMode,
}

/// How a box is started. The default starts a real process; a test supplies its own.
pub trait SpawnBox {
    /// Starts the box, or reports why it could not start.
    ///
    /// # Errors
    ///
    /// When the interpreter cannot be executed.
    fn spawn(&self, invocation: &BoxInvocation<'_>) -> std::io::Result<Box<dyn RunningBox>>;
}

/// A box that has started and not yet finished.
pub trait RunningBox {
    /// Reports the terminal result if the box has ended, without blocking.
    ///
    /// # Errors
    ///
    /// When the child's state cannot be read.
    fn try_wait(&mut self) -> std::io::Result<Option<(Option<i32>, Option<String>)>>;

    /// Forwards a signal the caller asked to pass on.
    fn forward(&mut self, signal: ForwardedSignal);
}

/// Starts a real process. Never through a shell: the argument vector is passed as it was built, so a
/// value from a manifest cannot become a second command.
pub struct ProcessSpawner;

impl SpawnBox for ProcessSpawner {
    fn spawn(&self, invocation: &BoxInvocation<'_>) -> std::io::Result<Box<dyn RunningBox>> {
        let mut command = Command::new(invocation.program);
        command
            .args(invocation.args)
            .current_dir(invocation.cwd)
            .env_clear()
            .envs(invocation.environment)
            .stdin(invocation.stdin.to_stdio())
            .stdout(invocation.stdout.to_stdio())
            .stderr(invocation.stderr.to_stdio());
        Ok(Box::new(ChildProcess(command.spawn()?)))
    }
}

struct ChildProcess(Child);

impl RunningBox for ChildProcess {
    fn try_wait(&mut self) -> std::io::Result<Option<(Option<i32>, Option<String>)>> {
        Ok(self
            .0
            .try_wait()?
            .map(|status| (status.code(), terminating_signal(status))))
    }

    fn forward(&mut self, signal: ForwardedSignal) {
        send_signal(&mut self.0, signal);
    }
}

/// How often the run loop checks for a signal to forward while the child is alive.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// A signal a caller may ask to be forwarded to the box.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForwardedSignal {
    /// `SIGINT`.
    Interrupt,
    /// `SIGTERM`.
    Terminate,
    /// `SIGHUP`.
    Hangup,
}

impl ForwardedSignal {
    /// The POSIX name, as it appears in a run result.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Interrupt => "SIGINT",
            Self::Terminate => "SIGTERM",
            Self::Hangup => "SIGHUP",
        }
    }
}

/// The sending half a caller keeps to forward signals into a running box.
pub type SignalSender = Sender<ForwardedSignal>;

/// The receiving half handed to [`run_extracted_box`].
pub type SignalReceiver = Receiver<ForwardedSignal>;

/// What a child's stream should be connected to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum StdioMode {
    /// Share this process's stream.
    #[default]
    Inherit,
    /// Connect to the null device.
    Null,
    /// Capture through a pipe the caller reads from the returned child handle.
    Piped,
}

impl StdioMode {
    fn to_stdio(self) -> Stdio {
        match self {
            Self::Inherit => Stdio::inherit(),
            Self::Null => Stdio::null(),
            Self::Piped => Stdio::piped(),
        }
    }
}

/// How a box should be run.
#[derive(Default)]
pub struct RunOptions<'a> {
    /// Arguments appended after the release's own `defaultArgs`.
    pub args: Vec<String>,
    /// Values merged over the inherited environment, and beneath the signed release's.
    pub env: Vec<(String, String)>,
    /// Where the child's standard input comes from.
    pub stdin: StdioMode,
    /// Where the child's standard output goes.
    pub stdout: StdioMode,
    /// Where the child's standard error goes.
    pub stderr: StdioMode,
    /// A channel this run forwards signals from, if the caller wants forwarding.
    pub signals: Option<&'a SignalReceiver>,
    /// Called once the environment is resolved and before the child starts.
    pub on_environment_report: Option<&'a dyn Fn(&EnvironmentReport)>,
    /// How much of the environment to describe.
    pub environment: EnvironmentReportOptions,
    /// The inherited environment. Defaults to this process's, and is injectable so a test can state a
    /// host environment instead of mutating the one every thread in the process shares.
    pub host_environment: Option<Vec<(String, String)>>,
    /// How the box is started. Defaults to a real process.
    pub spawn: Option<&'a dyn SpawnBox>,
}

/// How a box run ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoxRunResult {
    /// The child's exit code, absent when a signal ended it.
    pub exit_code: Option<i32>,
    /// The signal that ended the child, if one did.
    pub signal: Option<String>,
    /// The environment the child actually ran with.
    pub environment_report: EnvironmentReport,
}

/// Resolves the environment a run will use, from the three layers in precedence order.
fn resolve_run_environment(
    prepared: &PreparedBox,
    options: &RunOptions<'_>,
) -> Result<crate::environment::ResolvedEnvironment> {
    let release = prepared.release();
    let adapter = prepared.adapter();
    // Injectable rather than read directly, so a test can state a host environment without mutating
    // the one every thread in the process shares.
    let host: Vec<(String, String)> = options
        .host_environment
        .clone()
        .unwrap_or_else(|| std::env::vars().collect());
    let declared = release.environment.clone().unwrap_or_default();
    resolve_environment(&ResolveOptions {
        platform: adapter.platform,
        layers: vec![
            EnvironmentLayer {
                source: EnvironmentSource::Host,
                values: host
                    .iter()
                    .map(|(name, value)| (name.as_str(), value.as_str()))
                    .collect(),
            },
            EnvironmentLayer {
                source: EnvironmentSource::Caller,
                values: options
                    .env
                    .iter()
                    .map(|(name, value)| (name.as_str(), value.as_str()))
                    .collect(),
            },
            EnvironmentLayer {
                source: EnvironmentSource::Release,
                values: declared
                    .iter()
                    .map(|(name, value)| (name.as_str(), value.as_str()))
                    .collect(),
            },
        ],
        execution_affecting_variables: adapter.execution_affecting_environment_variables,
        expanded: options.environment.env_report || options.environment.env_report_values,
        reveal_host_values: options.environment.env_report_values,
    })
}

/// Executes a prepared box with its own interpreter and returns its terminal result.
///
/// # Errors
///
/// When the box declares no execution entry point, the host cannot run its target, the root is no
/// longer the one the receipt was minted for, a required file or asset is missing, or the
/// interpreter cannot be started.
pub fn run_extracted_box(prepared: &PreparedBox, options: &RunOptions<'_>) -> Result<BoxRunResult> {
    let release = prepared.release();
    let Some(execution) = release.execution.as_ref() else {
        fail!("Box does not declare an execution entry point.");
    };
    let adapter = prepared.adapter();
    if crate::contract::targets::assert_native_host(adapter).is_err() {
        fail!(
            "Box target {} cannot run on {}/{}; it requires {}/{}.",
            prepared.target_id(),
            std::env::consts::OS,
            std::env::consts::ARCH,
            adapter.host_os,
            adapter.host_arch
        );
    }

    // Re-checked immediately before execution rather than trusted from preparation: a receipt says
    // what was true when it was minted, and this is the last moment anything can be said about now.
    prepared.assert_root_unchanged()?;

    let root = prepared.root();
    let files = collect_files(root)?;
    if !files.contains(&release.python_entry_point) {
        fail!("Prepared box is missing {}.", release.python_entry_point);
    }
    assert_execution_files(
        Some(execution),
        adapter,
        &release.provenance.python_version,
        &files,
    )?;
    verify_required_assets(root, prepared.required_assets())?;

    let python = join_relative(root, &safe_relative_path(&release.python_entry_point)?);
    let mut arguments: Vec<String> = match execution {
        Execution::PythonScript { script, .. } => vec![join_relative(root, &safe_relative_path(script)?)
            .to_string_lossy()
            .into_owned()],
        Execution::PythonModule { module, .. } => vec!["-m".to_string(), module.clone()],
    };
    match execution {
        Execution::PythonScript { default_args, .. }
        | Execution::PythonModule { default_args, .. } => {
            arguments.extend(default_args.iter().cloned());
        }
    }
    arguments.extend(options.args.iter().cloned());

    let resolved = resolve_run_environment(prepared, options)?;
    if let Some(report) = options.on_environment_report {
        report(&resolved.report);
    }

    let invocation = BoxInvocation {
        program: &python,
        args: &arguments,
        cwd: root,
        environment: &resolved.environment,
        stdin: options.stdin,
        stdout: options.stdout,
        stderr: options.stderr,
    };
    let spawner: &dyn SpawnBox = options.spawn.unwrap_or(&ProcessSpawner);
    let child = spawner.spawn(&invocation).map_err(|error| {
        Error::new(format!(
            "Box interpreter failed to start: {}: {error}",
            python.display()
        ))
    })?;

    let (exit_code, signal) = wait_for(child, options.signals)?;
    Ok(BoxRunResult {
        exit_code,
        signal,
        environment_report: resolved.report,
    })
}

/// Waits for the child, forwarding any signal the caller sends while it is alive.
fn wait_for(
    mut child: Box<dyn RunningBox>,
    signals: Option<&SignalReceiver>,
) -> Result<(Option<i32>, Option<String>)> {
    loop {
        if let Some(result) = child.try_wait().map_err(Error::from)? {
            return Ok(result);
        }
        let Some(receiver) = signals else {
            std::thread::sleep(POLL_INTERVAL);
            continue;
        };
        match receiver.recv_timeout(POLL_INTERVAL) {
            Ok(signal) => child.forward(signal),
            // Disconnected means the caller dropped its sender, which is not a reason to stop
            // waiting: the child is still running and its result is still owed.
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => {}
        }
    }
}

#[cfg(unix)]
fn send_signal(child: &mut Child, signal: ForwardedSignal) {
    let Some(pid) = i32::try_from(child.id())
        .ok()
        .and_then(rustix::process::Pid::from_raw)
    else {
        return;
    };
    let native = match signal {
        ForwardedSignal::Interrupt => rustix::process::Signal::INT,
        ForwardedSignal::Terminate => rustix::process::Signal::TERM,
        ForwardedSignal::Hangup => rustix::process::Signal::HUP,
    };
    // A child that has already exited is not an error here: the wait loop will collect it next pass.
    let _ = rustix::process::kill_process(pid, native);
}

#[cfg(not(unix))]
fn send_signal(child: &mut Child, _signal: ForwardedSignal) {
    // Windows has no POSIX signals; every forwarded signal is a request to end the process, which is
    // also exactly what Node's `child.kill(signal)` does there.
    let _ = child.kill();
}

#[cfg(unix)]
fn terminating_signal(status: std::process::ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt as _;
    status.signal().map(|number| match number {
        2 => "SIGINT".to_string(),
        15 => "SIGTERM".to_string(),
        1 => "SIGHUP".to_string(),
        9 => "SIGKILL".to_string(),
        other => format!("SIG{other}"),
    })
}

#[cfg(not(unix))]
fn terminating_signal(_status: std::process::ExitStatus) -> Option<String> {
    None
}

/// Where a one-shot run should stage the box.
pub struct RunBoxOptions<'a> {
    /// The keys the caller accepts, from a trust file or already in hand.
    pub trust: TrustAnchors<'a>,
    /// The archive, when it is not beside its release document under its own hash.
    pub archive: Option<&'a Path>,
    /// Directory the temporary box is created inside. The caller owns it.
    pub temporary_root: &'a Path,
    /// How to run it.
    pub run: RunOptions<'a>,
}

/// Verifies, extracts, runs and removes a box in one call.
///
/// The extracted tree is deleted whatever happens — a normal exit, a signal, or a failure part way
/// through — because a temporary box that outlives its run is a box nobody will remember to remove.
///
/// # Errors
///
/// When verification, preparation or execution fails.
pub fn run_box(release_document_path: &Path, options: &RunBoxOptions<'_>) -> Result<BoxRunResult> {
    std::fs::create_dir_all(options.temporary_root)?;
    let destination: PathBuf = options.temporary_root.join(format!(
        "scrollcase-run-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default()
    ));

    let prepared = verify_and_extract_box(
        release_document_path,
        &PrepareOptions {
            trust: options.trust,
            archive: options.archive,
            destination: &destination,
            environment: options.run.environment.clone(),
        },
    );
    let result = match prepared {
        Ok(prepared) => run_extracted_box(&prepared, &options.run),
        Err(error) => Err(error),
    };
    let _ = std::fs::remove_dir_all(&destination);
    result
}
