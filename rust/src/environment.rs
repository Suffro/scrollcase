//! Environment resolution shared by every place a box interpreter is run.
//!
//! Inheritance is intentionally preserved: this is a provenance and precedence mechanism, not a
//! sandbox. Layers merge in order with the signed release last, so a release value wins over a
//! caller's and a caller's wins over the host's.
//!
//! Windows names are compared case-insensitively, because passing both `Path` and `PATH` to a child
//! would leave the winning value to whatever serialises the process environment rather than to this
//! contract.
//!
//! Host values are masked in the report by default. A variable inherited from the machine running
//! the box can hold a token or a path that identifies someone, and a diagnostic that leaks it by
//! default would be a worse failure than the one it was printed to diagnose.

use std::collections::BTreeMap;

use crate::error::{fail, Result};

const MASKED_VALUE: &str = "<masked>";

/// Where a value came from, in precedence order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum EnvironmentSource {
    /// Inherited from the process running the box.
    Host,
    /// Supplied by the caller for this run.
    Caller,
    /// Forced by a validation run onto one accelerator.
    Validation,
    /// Declared by the signed release. Always wins.
    Release,
}

impl EnvironmentSource {
    /// The name this source carries in a report.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Host => "host",
            Self::Caller => "caller",
            Self::Validation => "validation",
            Self::Release => "release",
        }
    }
}

/// One source's contribution to a variable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvironmentSourceValue {
    /// Which layer supplied it.
    pub source: EnvironmentSource,
    /// The exact spelling that layer used.
    pub name: String,
    /// The value, masked for inherited host values unless explicitly revealed.
    pub value: String,
}

/// What the report says about one variable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvironmentVariableReport {
    /// Exact spelling of the winning variable.
    pub name: String,
    /// The layer that won.
    pub source: EnvironmentSource,
    /// The winning value, subject to host-value masking.
    pub value: String,
    /// Whether an inherited host variable can change which code the interpreter loads.
    pub execution_affecting: bool,
    /// Whether the sources supplied different values.
    pub conflict: bool,
    /// Every contribution, in precedence order.
    pub sources: Vec<EnvironmentSourceValue>,
}

/// How much of the environment the report shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportMode {
    /// Only what is actionable: release values, conflicts, and dangerous inherited variables.
    Summary,
    /// Every variable.
    Full,
}

/// A diagnostic snapshot of the environment a box would run with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvironmentReport {
    /// Whether every variable is listed, or only the actionable ones.
    pub mode: ReportMode,
    /// Whether inherited host values are shown rather than masked.
    pub host_values_revealed: bool,
    /// How many variables the signed release declares.
    pub release_variable_count: usize,
    /// How many variables more than one source supplied a different value for.
    pub conflict_count: usize,
    /// Inherited variables that can change which code the interpreter loads.
    pub dangerous_host_variables: Vec<String>,
    /// Variables omitted from a compact summary.
    pub remaining_variable_count: usize,
    /// The variables the report lists.
    pub variables: Vec<EnvironmentVariableReport>,
}

impl EnvironmentReport {
    /// Whether the compact default has anything actionable to say.
    #[must_use]
    pub fn is_worth_reporting(&self) -> bool {
        self.mode == ReportMode::Full
            || self.release_variable_count > 0
            || self.conflict_count > 0
            || !self.dangerous_host_variables.is_empty()
    }
}

/// One layer of the environment.
pub struct EnvironmentLayer<'a> {
    /// Where these values came from.
    pub source: EnvironmentSource,
    /// The values themselves.
    pub values: Vec<(&'a str, &'a str)>,
}

/// Everything needed to resolve an environment and describe it.
pub struct ResolveOptions<'a> {
    /// Target platform, deciding whether names are case-insensitive.
    pub platform: &'a str,
    /// The layers, in precedence order.
    pub layers: Vec<EnvironmentLayer<'a>>,
    /// Inherited variables that can change which code the interpreter loads.
    pub execution_affecting_variables: &'a [&'a str],
    /// Whether to list every variable rather than only the actionable ones.
    pub expanded: bool,
    /// Whether to show inherited host values rather than masking them.
    pub reveal_host_values: bool,
}

/// The resolved environment, and the diagnostic describing how it was reached.
pub struct ResolvedEnvironment {
    /// What the child process receives.
    pub environment: BTreeMap<String, String>,
    /// What a caller is told about it.
    pub report: EnvironmentReport,
}

fn is_case_insensitive(platform: &str) -> bool {
    platform == "windows"
}

fn normalized_name(name: &str, platform: &str) -> String {
    if is_case_insensitive(platform) {
        name.to_uppercase()
    } else {
        name.to_string()
    }
}

/// Refuses a name or value a process environment cannot carry.
fn check_entry(source: EnvironmentSource, name: &str, value: &str) -> Result<()> {
    if name.is_empty() || name.contains('=') || name.contains('\0') || value.contains('\0') {
        fail!(
            "Box execution {} environment must map valid names to string values.",
            source.as_str()
        );
    }
    Ok(())
}

struct Record {
    sources: Vec<EnvironmentSourceValue>,
    winner: EnvironmentSourceValue,
}

/// Describes one variable, and says whether a compact summary should list it.
///
/// A variable earns its place in the summary by being declared by the release, by being an inherited
/// variable that can change executed code, or by having sources that disagree. Everything else is
/// counted and left out, which is what keeps the default readable on a machine with two hundred
/// environment variables.
fn describe(
    record: &Record,
    is_dangerous: bool,
    reveal_host_values: bool,
) -> (EnvironmentVariableReport, bool) {
    let has_host = record
        .sources
        .iter()
        .any(|entry| entry.source == EnvironmentSource::Host);
    let execution_affecting = is_dangerous && has_host;
    let distinct: std::collections::BTreeSet<&str> = record
        .sources
        .iter()
        .map(|entry| entry.value.as_str())
        .collect();
    let conflict = distinct.len() > 1;
    let visible = |entry: &EnvironmentSourceValue| {
        if entry.source == EnvironmentSource::Host && !reveal_host_values {
            MASKED_VALUE.to_string()
        } else {
            entry.value.clone()
        }
    };
    let has_release = record
        .sources
        .iter()
        .any(|entry| entry.source == EnvironmentSource::Release);
    (
        EnvironmentVariableReport {
            name: record.winner.name.clone(),
            source: record.winner.source,
            value: visible(&record.winner),
            execution_affecting,
            conflict,
            sources: record
                .sources
                .iter()
                .map(|entry| EnvironmentSourceValue {
                    source: entry.source,
                    name: entry.name.clone(),
                    value: visible(entry),
                })
                .collect(),
        },
        has_release || execution_affecting || conflict,
    )
}

/// Merges the layers in precedence order and produces the masked diagnostic.
///
/// # Errors
///
/// When a layer holds a name or value a process environment cannot carry.
pub fn resolve_environment(options: &ResolveOptions<'_>) -> Result<ResolvedEnvironment> {
    let platform = options.platform;
    let mut records: BTreeMap<String, Record> = BTreeMap::new();
    let mut environment: BTreeMap<String, String> = BTreeMap::new();
    let mut environment_names: BTreeMap<String, String> = BTreeMap::new();

    for layer in &options.layers {
        for (name, value) in &layer.values {
            check_entry(layer.source, name, value)?;
            let normalized = normalized_name(name, platform);
            let contribution = EnvironmentSourceValue {
                source: layer.source,
                name: (*name).to_string(),
                value: (*value).to_string(),
            };
            let record = records.entry(normalized.clone()).or_insert_with(|| Record {
                sources: Vec::new(),
                winner: contribution.clone(),
            });
            record.sources.push(contribution.clone());
            record.winner = contribution;

            // On Windows a later layer may spell the name differently. Dropping the earlier spelling
            // keeps exactly one of them in what the child receives.
            if let Some(previous) = environment_names.get(&normalized) {
                if previous != name {
                    environment.remove(previous);
                }
            }
            environment_names.insert(normalized, (*name).to_string());
            environment.insert((*name).to_string(), (*value).to_string());
        }
    }

    let dangerous: Vec<String> = options
        .execution_affecting_variables
        .iter()
        .map(|name| normalized_name(name, platform))
        .collect();

    let mut all: Vec<(EnvironmentVariableReport, bool)> = records
        .iter()
        .map(|(normalized, record)| {
            describe(record, dangerous.contains(normalized), options.reveal_host_values)
        })
        .collect();
    all.sort_by(|left, right| left.0.name.cmp(&right.0.name));

    let release_variable_count = records
        .values()
        .filter(|record| {
            record
                .sources
                .iter()
                .any(|entry| entry.source == EnvironmentSource::Release)
        })
        .count();
    let conflict_count = all.iter().filter(|(entry, _)| entry.conflict).count();
    let dangerous_host_variables: Vec<String> = all
        .iter()
        .filter(|(entry, _)| entry.execution_affecting)
        .filter_map(|(entry, _)| {
            entry
                .sources
                .iter()
                .find(|source| source.source == EnvironmentSource::Host)
                .map(|source| source.name.clone())
        })
        .collect();

    let total = all.len();
    let variables: Vec<EnvironmentVariableReport> = all
        .into_iter()
        .filter(|(_, selected)| options.expanded || *selected)
        .map(|(entry, _)| entry)
        .collect();

    Ok(ResolvedEnvironment {
        environment,
        report: EnvironmentReport {
            mode: if options.expanded {
                ReportMode::Full
            } else {
                ReportMode::Summary
            },
            host_values_revealed: options.reveal_host_values,
            release_variable_count,
            conflict_count,
            dangerous_host_variables,
            remaining_variable_count: total - variables.len(),
            variables,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_environment, EnvironmentLayer, EnvironmentSource, ReportMode, ResolveOptions,
    };

    fn options<'a>(
        platform: &'a str,
        layers: Vec<EnvironmentLayer<'a>>,
        dangerous: &'a [&'a str],
        expanded: bool,
        reveal: bool,
    ) -> ResolveOptions<'a> {
        ResolveOptions {
            platform,
            layers,
            execution_affecting_variables: dangerous,
            expanded,
            reveal_host_values: reveal,
        }
    }

    fn layer(source: EnvironmentSource, values: &[(&'static str, &'static str)]) -> EnvironmentLayer<'static> {
        EnvironmentLayer {
            source,
            values: values.to_vec(),
        }
    }

    #[test]
    fn the_signed_release_wins_over_the_caller_and_the_host() {
        let resolved = resolve_environment(&options(
            "linux",
            vec![
                layer(EnvironmentSource::Host, &[("SC_VAR", "host")]),
                layer(EnvironmentSource::Caller, &[("SC_VAR", "caller")]),
                layer(EnvironmentSource::Release, &[("SC_VAR", "release")]),
            ],
            &[],
            false,
            false,
        ))
        .unwrap();

        assert_eq!(resolved.environment["SC_VAR"], "release");
        let variable = &resolved.report.variables[0];
        assert_eq!(variable.source, EnvironmentSource::Release);
        assert!(variable.conflict);
        assert_eq!(resolved.report.conflict_count, 1);
        // The host contribution is listed, but its value is not.
        assert_eq!(variable.sources[0].source, EnvironmentSource::Host);
        assert_eq!(variable.sources[0].value, "<masked>");
    }

    #[test]
    fn a_host_value_is_shown_only_when_it_is_explicitly_asked_for() {
        let layers = || {
            vec![
                layer(EnvironmentSource::Host, &[("SC_SECRET", "token")]),
                layer(EnvironmentSource::Release, &[("SC_SECRET", "declared")]),
            ]
        };
        let masked = resolve_environment(&options("linux", layers(), &[], false, false)).unwrap();
        assert_eq!(masked.report.variables[0].sources[0].value, "<masked>");
        assert!(!masked.report.host_values_revealed);

        let revealed = resolve_environment(&options("linux", layers(), &[], false, true)).unwrap();
        assert_eq!(revealed.report.variables[0].sources[0].value, "token");
        assert!(revealed.report.host_values_revealed);
    }

    #[test]
    fn an_inherited_variable_that_can_change_executed_code_is_always_reported() {
        // PYTHONPATH is not declared by the release and conflicts with nothing, so only the
        // execution-affecting rule can put it in a compact summary.
        let resolved = resolve_environment(&options(
            "linux",
            vec![layer(
                EnvironmentSource::Host,
                &[("PYTHONPATH", "/host/code"), ("HOME", "/home/someone")],
            )],
            &["PYTHONPATH", "LD_PRELOAD"],
            false,
            false,
        ))
        .unwrap();

        assert_eq!(resolved.report.mode, ReportMode::Summary);
        assert_eq!(resolved.report.variables.len(), 1);
        assert_eq!(resolved.report.variables[0].name, "PYTHONPATH");
        assert!(resolved.report.variables[0].execution_affecting);
        assert_eq!(resolved.report.dangerous_host_variables, ["PYTHONPATH"]);
        // HOME is ordinary, so it is counted but not listed.
        assert_eq!(resolved.report.remaining_variable_count, 1);
    }

    #[test]
    fn a_release_variable_alone_is_not_a_conflict() {
        let resolved = resolve_environment(&options(
            "linux",
            vec![layer(EnvironmentSource::Release, &[("SC_ONLY", "value")])],
            &[],
            false,
            false,
        ))
        .unwrap();
        assert_eq!(resolved.report.release_variable_count, 1);
        assert_eq!(resolved.report.conflict_count, 0);
        assert!(!resolved.report.variables[0].conflict);
    }

    #[test]
    fn windows_names_collapse_by_case_so_only_one_reaches_the_child() {
        let resolved = resolve_environment(&options(
            "windows",
            vec![
                layer(EnvironmentSource::Host, &[("Path", "C:\\host")]),
                layer(EnvironmentSource::Release, &[("PATH", "C:\\box")]),
            ],
            &[],
            true,
            false,
        ))
        .unwrap();

        assert_eq!(resolved.environment.len(), 1);
        assert_eq!(resolved.environment["PATH"], "C:\\box");
        assert_eq!(resolved.report.variables.len(), 1);
        assert!(resolved.report.variables[0].conflict);

        // The same two names stay separate where case matters.
        let posix = resolve_environment(&options(
            "linux",
            vec![
                layer(EnvironmentSource::Host, &[("Path", "/host")]),
                layer(EnvironmentSource::Release, &[("PATH", "/box")]),
            ],
            &[],
            true,
            false,
        ))
        .unwrap();
        assert_eq!(posix.environment.len(), 2);
    }

    #[test]
    fn a_name_a_process_environment_cannot_carry_is_refused() {
        for (name, value) in [("", "v"), ("A=B", "v"), ("A\0B", "v"), ("A", "v\0")] {
            let result = resolve_environment(&options(
                "linux",
                vec![EnvironmentLayer {
                    source: EnvironmentSource::Release,
                    values: vec![(name, value)],
                }],
                &[],
                false,
                false,
            ));
            assert!(result.is_err(), "{name}={value} was accepted");
        }
    }

    #[test]
    fn the_full_report_lists_everything_the_summary_counts() {
        let layers = || {
            vec![layer(
                EnvironmentSource::Host,
                &[("A", "1"), ("B", "2"), ("C", "3")],
            )]
        };
        let summary = resolve_environment(&options("linux", layers(), &[], false, false)).unwrap();
        assert!(summary.report.variables.is_empty());
        assert_eq!(summary.report.remaining_variable_count, 3);
        assert!(!summary.report.is_worth_reporting());

        let full = resolve_environment(&options("linux", layers(), &[], true, false)).unwrap();
        assert_eq!(full.report.variables.len(), 3);
        assert_eq!(full.report.remaining_variable_count, 0);
        assert!(full.report.is_worth_reporting());
    }
}
