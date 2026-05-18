"""Atlas Spec Graph v1 — Python bindings.

Public API (matches docs/superpowers/specs/2026-04-20-spec-graph-schema-py-and-c1-d1-refresh-design.md §7):
    SpecGraph                                   — root Pydantic model
    14 node types: Page, Route, Component, ClientState, Model, Endpoint,
                   Flow, AuthBoundary, Test, DesignToken, Dependency,
                   ComplianceClass, AIFeature, MediaAsset
    13 edge types: RendersEdge, FetchesEdge, ReadsEdge, MutatesEdge,
                   RequiresEdge, CoversEdge, DependsOnEdge, StyledByEdge,
                   SubjectToEdge, SupersedesEdge, PowersEdge, DisplaysEdge,
                   ManagesEdge
    InvariantCode, INVARIANT_CODES              — canonical error vocabulary
    validate_structural                         — Draft 2020-12 validator
    StructuralValidationResult, StructuralIssue — result dataclasses
"""
from __future__ import annotations

from .invariants import INVARIANT_CODES, InvariantCode
from .models import (
    AIFeature,
    AuthBoundary,
    ClientState,
    Component,
    ComplianceClass,
    CoversEdge,
    Dependency,
    DependsOnEdge,
    DesignToken,
    DisplaysEdge,
    Endpoint,
    FetchesEdge,
    Flow,
    ManagesEdge,
    MediaAsset,
    Model,
    MutatesEdge,
    Page,
    PowersEdge,
    ReadsEdge,
    RendersEdge,
    RequiresEdge,
    Route,
    SpecGraph,
    StyledByEdge,
    SubjectToEdge,
    SupersedesEdge,
    Test,
)
from .validate_structural import (
    StructuralIssue,
    StructuralValidationResult,
    validate_structural,
)

__all__ = [
    # Root
    "SpecGraph",
    # Nodes (14)
    "Page", "Route", "Component", "ClientState", "Model", "Endpoint",
    "Flow", "AuthBoundary", "Test", "DesignToken", "Dependency",
    "ComplianceClass", "AIFeature", "MediaAsset",
    # Edges (13)
    "RendersEdge", "FetchesEdge", "ReadsEdge", "MutatesEdge",
    "RequiresEdge", "CoversEdge", "DependsOnEdge", "StyledByEdge",
    "SubjectToEdge", "SupersedesEdge", "PowersEdge", "DisplaysEdge",
    "ManagesEdge",
    # Error vocabulary
    "InvariantCode", "INVARIANT_CODES",
    # Validation
    "validate_structural",
    "StructuralValidationResult", "StructuralIssue",
]
