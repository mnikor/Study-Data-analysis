from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.models.analysis import AnalysisRunRequest, DatasetReference
from backend.app.services.analysis_service import AnalysisService

FIXTURE_DIR = ROOT / "backend" / "tests" / "fixtures"
REPORT_PATH = ROOT / "docs" / "reference-validation-report.md"


def dataset(name: str, role: str) -> DatasetReference:
    content = (FIXTURE_DIR / name).read_text()
    return DatasetReference(
        file_id=name,
        name=name,
        role=role,
        content=content,
        column_names=content.splitlines()[0].split(","),
    )


def run_case(service: AnalysisService, title: str, question: str, datasets: list[DatasetReference]) -> str:
    response = service.run_analysis(AnalysisRunRequest(question=question, datasets=datasets))
    metrics = {metric.name: metric.value for metric in response.metrics}
    lines = [
        f"## {title}",
        "",
        f"- Status: `{response.status}`",
        f"- Executed: `{response.executed}`",
        f"- Analysis family: `{response.analysis_family}`",
        f"- Interpretation: {response.interpretation or response.explanation}",
    ]
    if metrics:
        lines.append("- Metrics:")
        for key, value in metrics.items():
            lines.append(f"  - `{key}`: `{value}`")
    if response.table is not None:
        lines.append(f"- Result rows: `{len(response.table.rows)}`")
    if response.warnings:
        lines.append("- Warnings:")
        for warning in response.warnings:
            lines.append(f"  - {warning}")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    service = AnalysisService()
    sections = [
        "# Reference Validation Report",
        "",
        "This report captures deterministic backend fixture runs for the newer clinical analysis families.",
        "",
        run_case(
            service,
            "Repeated Measures",
            "Using repeated visit-level measurements, estimate how ALT changes over time by treatment arm and whether treatment modifies the time trend.",
            [dataset("adsl_repeated.csv", "ADSL"), dataset("adlb_repeated.csv", "ADLB")],
        ),
        run_case(
            service,
            "Threshold Search",
            "Identify early-warning thresholds from Weeks 1-4 dermatologic events that best predict later treatment discontinuation or non-persistence.",
            [
                dataset("adsl_persistence.csv", "ADSL"),
                dataset("adae_persistence.csv", "ADAE"),
                dataset("ds_persistence.csv", "DS"),
            ],
        ),
        run_case(
            service,
            "Competing Risks",
            "What is the cumulative incidence of treatment discontinuation by arm when death is treated as a competing event?",
            [dataset("adsl_persistence.csv", "ADSL"), dataset("ds_persistence.csv", "DS")],
        ),
    ]
    REPORT_PATH.write_text("\n".join(sections))
    print(f"Wrote {REPORT_PATH}")


if __name__ == "__main__":
    main()
