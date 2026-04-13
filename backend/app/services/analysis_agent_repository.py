from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from ..models.analysis import AnalysisAgentRunResponse, AnalysisAgentRunSummary


class FileAnalysisAgentRepository:
    def __init__(self, root_dir: str) -> None:
        self.root = Path(root_dir)
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, run: AnalysisAgentRunResponse) -> None:
        run_dir = self.root / run.run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = run_dir / "run.json"
        manifest_path.write_text(
            json.dumps(run.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )

    def load(self, run_id: str) -> AnalysisAgentRunResponse | None:
        manifest_path = self.root / run_id / "run.json"
        if not manifest_path.exists():
            return None
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        payload.setdefault("question", "")
        payload.setdefault("created_at", self._manifest_created_at(manifest_path))
        return AnalysisAgentRunResponse(**payload)

    def list_recent(self, limit: int = 20) -> list[AnalysisAgentRunSummary]:
        manifests = list(self.root.glob("*/run.json"))
        summaries: list[AnalysisAgentRunSummary] = []

        for manifest_path in manifests:
            try:
                payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue

            created_at = payload.get("created_at") or self._manifest_created_at(manifest_path)
            summaries.append(
                AnalysisAgentRunSummary(
                    run_id=payload.get("run_id") or manifest_path.parent.name,
                    question=payload.get("question", ""),
                    created_at=created_at,
                    status=payload.get("status", "unsupported"),
                    missing_roles=payload.get("missing_roles", []),
                    executed=payload.get("executed", False),
                    analysis_family=payload.get("analysis_family", "unknown"),
                    selected_sources=payload.get("selected_sources", []),
                )
            )

        summaries.sort(
            key=lambda run: run.created_at or "",
            reverse=True,
        )
        return summaries[:limit]

    def _manifest_created_at(self, manifest_path: Path) -> str:
        timestamp = manifest_path.stat().st_mtime
        return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()
