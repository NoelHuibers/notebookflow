"""Tests for Loader.load_callable + Loader.render_template plumbing."""

from __future__ import annotations

import pytest

from notebookflow.protocol.loader import Loader, _split_reference
from notebookflow.protocol.manifest import NodeManifest
from notebookflow.protocol.registry import Registry


def _registry_with(manifest_id: str) -> Registry:
    registry = Registry()
    registry.register(
        NodeManifest(
            id=manifest_id,
            name="Test Node",
            tag="transform",
            template="x = 1\n",
        ),
    )
    return registry


def test_load_callable_resolves_colon_form() -> None:
    loader = Loader(_registry_with("os.path:join"))
    fn = loader.load_callable("os.path:join")
    assert callable(fn)
    assert fn("a", "b").replace("\\", "/") == "a/b"


def test_load_callable_resolves_dot_form() -> None:
    loader = Loader(_registry_with("os.path.join"))
    fn = loader.load_callable("os.path.join")
    assert callable(fn)


def test_load_callable_raises_keyerror_when_manifest_missing() -> None:
    loader = Loader(Registry())
    with pytest.raises(KeyError):
        loader.load_callable("os.path:join")


def test_load_callable_raises_valueerror_when_module_missing() -> None:
    loader = Loader(_registry_with("notebookflow_no_such_pkg.thing:run"))
    with pytest.raises(ValueError, match="Cannot import module"):
        loader.load_callable("notebookflow_no_such_pkg.thing:run")


def test_load_callable_raises_valueerror_when_attr_missing() -> None:
    loader = Loader(_registry_with("os.path:no_such_attr"))
    with pytest.raises(ValueError, match="has no attribute"):
        loader.load_callable("os.path:no_such_attr")


def test_load_callable_raises_typeerror_when_target_not_callable() -> None:
    # os.path.sep is a string, not callable.
    loader = Loader(_registry_with("os.path:sep"))
    with pytest.raises(TypeError, match="not a callable"):
        loader.load_callable("os.path:sep")


def test_load_callable_raises_valueerror_on_unparseable_reference() -> None:
    loader = Loader(_registry_with("noModuleDot"))
    with pytest.raises(ValueError, match="Invalid callable reference"):
        loader.load_callable("noModuleDot")


def test_split_reference_colon() -> None:
    assert _split_reference("pkg.module:attr") == ("pkg.module", "attr")


def test_split_reference_dot() -> None:
    assert _split_reference("pkg.module.attr") == ("pkg.module", "attr")


def test_split_reference_empty_module_raises() -> None:
    with pytest.raises(ValueError, match="Invalid"):
        _split_reference(":attr")


def test_split_reference_empty_attr_raises() -> None:
    with pytest.raises(ValueError, match="Invalid"):
        _split_reference("pkg.module:")


def test_render_template_substitutes_named_placeholders() -> None:
    registry = Registry()
    manifest = NodeManifest(
        id="test.t",
        name="T",
        tag="transform",
        template="{primary_output} = pd.read_csv({path_literal})\n",
    )
    registry.register(manifest)
    out = Loader(registry).render_template(
        manifest,
        {"output_vars": ["df"], "config": {"path": "data.csv"}},
    )
    assert out == 'df = pd.read_csv("data.csv")\n'


def test_render_template_falls_back_to_first_port_name() -> None:
    registry = Registry()
    manifest = NodeManifest(
        id="test.t2",
        name="T",
        tag="transform",
        template="{primary_output} = 1\n",
        outputs=[],
    )
    registry.register(manifest)
    out = Loader(registry).render_template(manifest, {})
    assert out == "result = 1\n"


def test_render_template_substitutes_primary_input_and_output_literals() -> None:
    registry = Registry()
    manifest = NodeManifest(
        id="test.t_lit",
        name="T",
        tag="transform",
        template=(
            "x = locals().get({primary_input_literal})\n"
            "result = {primary_output_literal}\n"
        ),
        inputs=[],
        outputs=[],
    )
    registry.register(manifest)
    out = Loader(registry).render_template(
        manifest,
        {"input_vars": ["upstream.df"], "output_vars": ["downstream"]},
    )
    assert 'locals().get("upstream.df")' in out
    assert 'result = "downstream"' in out


def test_render_template_works_for_every_builtin_ai_manifest() -> None:
    """Smoke check: every ai/* template renders cleanly with sample params."""
    from notebookflow.nodes.ai import AI_PYTHON_TRANSFORM, CLASSIFY, EMBED, LLM_GENERATE

    registry = Registry()
    for manifest in (AI_PYTHON_TRANSFORM, LLM_GENERATE, EMBED, CLASSIFY):
        registry.register(manifest)
        loader = Loader(registry)
        # Default config values are enough -- they're set on every required field.
        config = {f.key: f.default_value for f in manifest.config_fields}
        rendered = loader.render_template(
            manifest,
            {
                "input_vars": [p.name for p in manifest.inputs],
                "output_vars": [p.name for p in manifest.outputs],
                "config": config,
            },
        )
        # format_map() would already have raised ValueError on a missing
        # placeholder; this asserts the template body is non-empty and
        # terminated. Literal { in the source escapes as {{, which is fine.
        assert rendered.endswith("\n")
        assert len(rendered) > 0


def test_render_template_raises_on_unknown_placeholder() -> None:
    registry = Registry()
    manifest = NodeManifest(
        id="test.t3",
        name="T",
        tag="transform",
        template="{not_in_context}\n",
    )
    registry.register(manifest)
    with pytest.raises(ValueError, match="unknown template variable"):
        Loader(registry).render_template(manifest, {})
