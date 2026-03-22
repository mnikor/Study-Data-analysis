from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd


class FileWorkspaceRepository:
    def __init__(self, root_dir: str) -> None:
        self.root = Path(root_dir)
        self.root.mkdir(parents=True, exist_ok=True)

    def save(
        self,
        workspace_id: str,
        dataframe: pd.DataFrame,
        metadata: dict[str, Any],
        source_names: list[str],
        notes: list[str],
        derived_columns: list[str],
    ) -> None:
        workspace_dir = self.root / workspace_id
        workspace_dir.mkdir(parents=True, exist_ok=True)

        dataframe.to_csv(workspace_dir / "workspace.csv", index=False)
        manifest = {
            "workspace_id": workspace_id,
            "metadata": metadata,
            "source_names": source_names,
            "notes": notes,
            "derived_columns": derived_columns,
            "row_count": int(dataframe.shape[0]),
            "column_count": int(dataframe.shape[1]),
            "columns": list(dataframe.columns),
        }
        (workspace_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    def load(self, workspace_id: str) -> dict[str, Any] | None:
        workspace_dir = self.root / workspace_id
        manifest_path = workspace_dir / "manifest.json"
        dataframe_path = workspace_dir / "workspace.csv"
        if not manifest_path.exists() or not dataframe_path.exists():
            return None

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        dataframe = pd.read_csv(dataframe_path)
        return {
            "dataframe": dataframe,
            "metadata": manifest.get("metadata", {}),
            "source_names": manifest.get("source_names", []),
            "notes": manifest.get("notes", []),
            "derived_columns": manifest.get("derived_columns", []),
            "row_count": manifest.get("row_count"),
            "column_count": manifest.get("column_count"),
        }

