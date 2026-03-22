from __future__ import annotations

from pathlib import Path
import unittest

from backend.app.models.analysis import AnalysisRunRequest, DatasetReference
from backend.app.services.analysis_service import AnalysisService


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


def _dataset(name: str, role: str) -> DatasetReference:
    path = FIXTURE_DIR / name
    return DatasetReference(
        file_id=name,
        name=name,
        role=role,
        content=path.read_text(),
        column_names=path.read_text().splitlines()[0].split(","),
    )


class ReferenceValidationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.service = AnalysisService()

    def test_mixed_model_fixture_executes(self) -> None:
        response = self.service.run_analysis(
            AnalysisRunRequest(
                question="Using repeated visit-level measurements, estimate how ALT changes over time by treatment arm and whether treatment modifies the time trend.",
                datasets=[
                    _dataset("adsl_repeated.csv", "ADSL"),
                    _dataset("adlb_repeated.csv", "ADLB"),
                ],
            )
        )

        self.assertTrue(response.executed)
        self.assertEqual(response.analysis_family, "mixed_model")
        metrics = {metric.name: metric.value for metric in response.metrics}
        self.assertEqual(metrics["subjects_used"], 4)
        self.assertEqual(metrics["observations_used"], 12)

    def test_threshold_search_fixture_executes(self) -> None:
        response = self.service.run_analysis(
            AnalysisRunRequest(
                question="Identify early-warning thresholds from Weeks 1-4 dermatologic events that best predict later treatment discontinuation or non-persistence.",
                datasets=[
                    _dataset("adsl_persistence.csv", "ADSL"),
                    _dataset("adae_persistence.csv", "ADAE"),
                    _dataset("ds_persistence.csv", "DS"),
                ],
            )
        )

        self.assertTrue(response.executed)
        self.assertEqual(response.analysis_family, "threshold_search")
        self.assertIsNotNone(response.table)
        self.assertGreater(len(response.table.rows), 0)

    def test_competing_risks_fixture_executes(self) -> None:
        response = self.service.run_analysis(
            AnalysisRunRequest(
                question="What is the cumulative incidence of treatment discontinuation by arm when death is treated as a competing event?",
                datasets=[
                    _dataset("adsl_persistence.csv", "ADSL"),
                    _dataset("ds_persistence.csv", "DS"),
                ],
            )
        )

        self.assertTrue(response.executed)
        self.assertEqual(response.analysis_family, "competing_risks")
        self.assertIsNotNone(response.table)
        self.assertEqual(response.table.title, "Competing-risks cumulative incidence by treatment group")


if __name__ == "__main__":
    unittest.main()
