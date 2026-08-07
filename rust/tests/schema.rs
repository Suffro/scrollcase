//! The types are the runtime shape check; these schemas are what makes that legitimate.
//!
//! Node and Python validate release documents against the canonical JSON schemas at runtime. This
//! crate encodes those schemas as types instead — a decision that is only defensible while the two
//! actually agree. So this suite runs both over the same documents and asserts they reach the same
//! verdict, on the examples and on a battery of mutations chosen to poke at the places where a typed
//! parse and a schema most plausibly drift apart: an unknown field, a missing required field, a
//! pattern violation, a broken bound, and the `weights`/`assets` co-requirement.
//!
//! Agreement is checked in both directions. Drifting *stricter* than the schema is as much a
//! divergence as drifting looser, and it is the direction a typed parse drifts by default: the last
//! test here is the one open object in the format, where agreeing means accepting.
//!
//! `jsonschema` is a development dependency only. It never ships to a consumer of this crate; it
//! exists so a divergence between the types and the format is a red test here instead of a
//! difference of behaviour on someone's machine.

#![allow(clippy::too_many_lines, clippy::type_complexity)]

use jsonschema::Validator;
use scrollcase_consumer::release::{BoxManifest, ReleaseManifest};
use serde_json::{json, Value};

const RELEASE_SCHEMA: &str = include_str!("../src/contract/schema/release-manifest.schema.json");
const BOX_SCHEMA: &str = include_str!("../src/contract/schema/box-manifest.schema.json");
const TARGET_SCHEMA: &str = include_str!("../src/contract/schema/target.schema.json");
const EXECUTION_SCHEMA: &str = include_str!("../src/contract/schema/execution.schema.json");
const RELEASE_EXAMPLE: &str = include_str!("../fixtures/examples/release-manifest.example.json");
const BOX_EXAMPLE: &str = include_str!("../fixtures/examples/box-manifest.example.json");

/// Every canonical schema, registered under its own `$id` so `$ref` resolves across files exactly as
/// it does for the Node and Python consumers — and offline, because a test must never reach the
/// network to fetch a schema.
fn registry() -> jsonschema::Registry<'static> {
    let mut builder = jsonschema::Registry::new();
    for raw in [RELEASE_SCHEMA, BOX_SCHEMA, TARGET_SCHEMA, EXECUTION_SCHEMA] {
        let schema: Value = serde_json::from_str(raw).unwrap();
        let id = schema["$id"].as_str().unwrap().to_string();
        builder = builder
            .add(id, jsonschema::Resource::from_contents(schema))
            .expect("canonical schema must register");
    }
    builder.prepare().expect("registry must prepare")
}

/// Builds a validator for one canonical schema against that registry.
fn validator(registry: &jsonschema::Registry, root: &str) -> Validator {
    jsonschema::options()
        .with_registry(registry)
        .build(&serde_json::from_str::<Value>(root).unwrap())
        .expect("canonical schema must compile")
}

/// Whether the typed surface accepts a document: it must parse *and* pass the explicit checks that
/// the type system cannot express.
fn types_accept_release(value: &Value) -> bool {
    serde_json::from_value::<ReleaseManifest>(value.clone())
        .is_ok_and(|release| release.validate().is_ok())
}

#[test]
fn the_canonical_examples_pass_both_the_schema_and_the_types() {
    let registry = registry();
    let release: Value = serde_json::from_str(RELEASE_EXAMPLE).unwrap();
    assert!(validator(&registry, RELEASE_SCHEMA).is_valid(&release));
    assert!(types_accept_release(&release));

    let box_manifest: Value = serde_json::from_str(BOX_EXAMPLE).unwrap();
    assert!(validator(&registry, BOX_SCHEMA).is_valid(&box_manifest));
    assert!(serde_json::from_value::<BoxManifest>(box_manifest).is_ok());
}

#[test]
fn the_types_and_the_schema_agree_on_every_mutation() {
    let registry = registry();
    let schema = validator(&registry, RELEASE_SCHEMA);
    let base: Value = serde_json::from_str(RELEASE_EXAMPLE).unwrap();
    assert!(schema.is_valid(&base) && types_accept_release(&base));

    // Each case mutates the canonical example. The assertion is not "both reject" — it is that the
    // two reach the *same* verdict, which is the only thing that makes the type-based runtime check
    // a faithful stand-in for the schema-based one the other implementations run.
    let mutations: Vec<(&str, Box<dyn Fn(&mut Value)>)> = vec![
        (
            "an unknown top-level field",
            Box::new(|value: &mut Value| {
                value["surprise"] = json!("unexpected");
            }),
        ),
        (
            "an unknown nested field",
            Box::new(|value: &mut Value| {
                value["archive"]["surprise"] = json!(1);
            }),
        ),
        (
            "a missing required field",
            Box::new(|value: &mut Value| {
                value.as_object_mut().unwrap().remove("provenance");
            }),
        ),
        (
            "a missing required nested field",
            Box::new(|value: &mut Value| {
                value["archive"].as_object_mut().unwrap().remove("sha256");
            }),
        ),
        (
            "a schema version from another format revision",
            Box::new(|value: &mut Value| {
                value["schemaVersion"] = json!(3);
            }),
        ),
        (
            "a kind outside the release namespace rule",
            Box::new(|value: &mut Value| {
                value["kind"] = json!("Scrollcase.Box.Release");
            }),
        ),
        (
            "a kind naming another document type",
            Box::new(|value: &mut Value| {
                value["kind"] = json!("scrollcase.box.channel");
            }),
        ),
        (
            "an identifier that is not lowercase dotted",
            Box::new(|value: &mut Value| {
                value["boxId"] = json!("Hello_Box");
            }),
        ),
        (
            "an archive digest that is not SHA-256",
            Box::new(|value: &mut Value| {
                value["archive"]["sha256"] = json!("not-a-digest");
            }),
        ),
        (
            "an uppercase archive digest",
            Box::new(|value: &mut Value| {
                value["archive"]["sha256"] = json!("A".repeat(64));
            }),
        ),
        (
            "a zero archive size",
            Box::new(|value: &mut Value| {
                value["archive"]["sizeBytes"] = json!(0);
            }),
        ),
        (
            "a zero installed size",
            Box::new(|value: &mut Value| {
                value["installedSizeBytes"] = json!(0);
            }),
        ),
        (
            "an empty self-test import list",
            Box::new(|value: &mut Value| {
                value["selfTest"]["pythonImports"] = json!([]);
            }),
        ),
        (
            "a builder revision that is not a commit",
            Box::new(|value: &mut Value| {
                value["provenance"]["builderRevision"] = json!("abc");
            }),
        ),
        (
            "weights without assets",
            Box::new(|value: &mut Value| {
                value["weights"] = json!("on-demand");
                value.as_object_mut().unwrap().remove("assets");
            }),
        ),
        (
            "assets without weights",
            Box::new(|value: &mut Value| {
                value.as_object_mut().unwrap().remove("weights");
                value["assets"] = json!([{
                    "url": "https://example.invalid/w.bin",
                    "relativePath": "weights/w.bin",
                    "sizeBytes": 1,
                    "sha256": "a".repeat(64),
                }]);
            }),
        ),
        (
            "an execution kind the format does not define",
            Box::new(|value: &mut Value| {
                value["execution"] = json!({ "kind": "shell", "command": "sh" });
            }),
        ),
        (
            "an execution module carrying command-line syntax",
            Box::new(|value: &mut Value| {
                value["execution"] =
                    json!({ "kind": "python-module", "module": "a; rm -rf /", "defaultArgs": [] });
            }),
        ),
        (
            "a target outside the supported matrix",
            Box::new(|value: &mut Value| {
                value["target"] = json!({
                    "platform": "solaris", "arch": "sparc", "accelerator": "cpu",
                });
            }),
        ),
        (
            "a host environment the format does not define",
            Box::new(|value: &mut Value| {
                value["compatibility"]["hostEnvironments"] = json!(["docker"]);
            }),
        ),
        // `compatibility` is open, so the types collect what they do not recognise. A defined key
        // must not slip into that collection when its value is the wrong type: it is a malformed
        // constraint, not a project's own.
        (
            "a defined compatibility constraint carrying the wrong type",
            Box::new(|value: &mut Value| {
                value["compatibility"]["minRamGb"] = json!("plenty");
            }),
        ),
    ];

    for (name, mutate) in mutations {
        let mut mutated = base.clone();
        mutate(&mut mutated);
        let schema_accepts = schema.is_valid(&mutated);
        let types_accept = types_accept_release(&mutated);
        assert_eq!(
            schema_accepts, types_accept,
            "{name}: the canonical schema and the typed check disagree \
             (schema accepted: {schema_accepts}, types accepted: {types_accept})"
        );
        assert!(!schema_accepts, "{name}: the mutation was supposed to be invalid");
    }
}

/// The battery above is all rejections; this is the case where agreement means *accepting*.
///
/// `compatibility` is the one object the canonical schema leaves open, because a publishing project
/// may state constraints in its own vocabulary and the builder copies them through untouched. A
/// typed parse that refused them would be stricter than the schema this crate ships — and would
/// refuse boxes Node and Python accept.
#[test]
fn a_compatibility_constraint_the_format_does_not_define_is_carried_not_refused() {
    let registry = registry();
    let schema = validator(&registry, RELEASE_SCHEMA);
    let mut release: Value = serde_json::from_str(RELEASE_EXAMPLE).unwrap();
    release["compatibility"]["org.example.minVramGb"] = json!(24);

    assert!(schema.is_valid(&release), "the canonical schema leaves compatibility open");
    assert!(
        types_accept_release(&release),
        "the types refused a constraint the schema they mirror accepts"
    );

    // Carried, not merely tolerated: the application is the one that has to refuse a box over a
    // constraint it cannot evaluate, and it cannot do that with a value the parse threw away.
    let parsed: ReleaseManifest = serde_json::from_value(release.clone()).unwrap();
    assert_eq!(
        parsed.compatibility.additional.get("org.example.minVramGb"),
        Some(&json!(24))
    );
    assert!(parsed.compatibility.min_ram_gb.is_some(), "a defined constraint stays typed");
    assert_eq!(
        serde_json::to_value(&parsed.compatibility).unwrap()["org.example.minVramGb"],
        json!(24),
        "an unknown constraint must survive a round trip unchanged"
    );
}
