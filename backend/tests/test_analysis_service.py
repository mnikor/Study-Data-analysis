import os
import shutil
import tempfile
import unittest

from backend.app.config import get_settings
from backend.app.models.analysis import AnalysisRunRequest, DatasetReference, WorkspaceBuildRequest
from backend.app.services.analysis_service import AnalysisService


class AnalysisServicePersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.workspace_dir = tempfile.mkdtemp(prefix="ecp-workspaces-")
        os.environ["ECP_WORKSPACE_STORE_DIR"] = self.workspace_dir
        get_settings.cache_clear()
        self.datasets = [
            DatasetReference(
                file_id="adsl",
                name="adsl.csv",
                role="ADSL",
                column_names=["USUBJID", "TRT01A", "AGE", "SEX", "RACE"],
                content="\n".join(
                    [
                        "USUBJID,TRT01A,AGE,SEX,RACE",
                        "01,Enhanced DM,70,F,ASIAN",
                        "02,Enhanced DM,60,F,ASIAN",
                        "03,SoC DM,68,F,ASIAN",
                        "04,SoC DM,72,M,ASIAN",
                        "05,SoC DM,66,F,WHITE",
                    ]
                ),
            ),
            DatasetReference(
                file_id="adae",
                name="adae.csv",
                role="ADAE",
                column_names=["USUBJID", "AETERM", "AETOXGR", "AESTDY"],
                content="\n".join(
                    [
                        "USUBJID,AETERM,AETOXGR,AESTDY",
                        "01,Rash,2,50",
                        "03,Rash,3,20",
                        "05,Rash,2,30",
                    ]
                ),
            ),
        ]
        self.question = (
            "Among Asian women >=65, what is the cumulative incidence of Grade >=2 DAEIs by Week 12 "
            "in enhanced DM vs SoC DM, and what is the risk difference + 95% CI?"
        )

    def tearDown(self) -> None:
        os.environ.pop("ECP_WORKSPACE_STORE_DIR", None)
        get_settings.cache_clear()
        shutil.rmtree(self.workspace_dir, ignore_errors=True)

    def test_workspace_persists_across_service_instances(self) -> None:
        builder_service = AnalysisService()
        build_response = builder_service.build_workspace(
            WorkspaceBuildRequest(question=self.question, datasets=self.datasets)
        )

        self.assertEqual(build_response.status, "executable")
        self.assertIsNotNone(build_response.workspace_id)
        self.assertEqual(build_response.row_count, 2)

        runner_service = AnalysisService()
        run_response = runner_service.run_analysis(
            AnalysisRunRequest(
                question=self.question,
                datasets=self.datasets,
                workspace_id=build_response.workspace_id,
            )
        )

        self.assertTrue(run_response.executed)
        self.assertEqual(run_response.workspace_id, build_response.workspace_id)
        self.assertIsNotNone(run_response.receipt)
        self.assertEqual(run_response.receipt.row_count, 2)
        self.assertIn("Asian women >=65", ", ".join(run_response.receipt.cohort_filters_applied))

    def test_run_response_includes_execution_receipt(self) -> None:
        service = AnalysisService()
        run_response = service.run_analysis(
            AnalysisRunRequest(question=self.question, datasets=self.datasets)
        )

        self.assertTrue(run_response.executed)
        self.assertIsNotNone(run_response.receipt)
        self.assertEqual(run_response.receipt.treatment_variable, "TRT01A")
        self.assertEqual(run_response.receipt.outcome_variable, "AE_OUTCOME_FLAG")
        self.assertGreaterEqual(len(run_response.receipt.source_names), 2)
        self.assertIn("AE_OUTCOME_FLAG", run_response.receipt.derived_columns)

    def test_time_to_resolution_cox_falls_back_to_dense_predictor_subset(self) -> None:
        adsl_rows = ["USUBJID,TRT01A,AGE,SEX,RACE"]
        adae_rows = ["USUBJID,AETERM,AETOXGR,AESTDY,AEENDY"]
        for index in range(1, 13):
            treatment = "Enhanced DM" if index <= 6 else "SoC DM"
            if index <= 6:
                age = str(60 + index)
                sex = ""
                race = "ASIAN"
            else:
                age = ""
                sex = "F" if index % 2 == 0 else "M"
                race = "WHITE" if index % 2 == 0 else "ASIAN"
            adsl_rows.append(f"{index:02d},{treatment},{age},{sex},{race}")
            adae_rows.append(f"{index:02d},Rash,{2 if index % 3 else 3},{8 + index},{18 + index}")

        sparse_datasets = [
            DatasetReference(
                file_id="adsl_sparse",
                name="adsl_sparse.csv",
                role="ADSL",
                column_names=["USUBJID", "TRT01A", "AGE", "SEX", "RACE"],
                content="\n".join(adsl_rows),
            ),
            DatasetReference(
                file_id="adae_sparse",
                name="adae_sparse.csv",
                role="ADAE",
                column_names=["USUBJID", "AETERM", "AETOXGR", "AESTDY", "AEENDY"],
                content="\n".join(adae_rows),
            ),
        ]

        service = AnalysisService()
        response = service.run_analysis(
            AnalysisRunRequest(
                question=(
                    "Among participants who develop Grade >=2 DAEIs, what factors predict time to resolution "
                    "(faster vs slower recovery), and do these predictors differ by arm?"
                ),
                datasets=sparse_datasets,
            )
        )

        self.assertTrue(response.executed)
        self.assertEqual(response.analysis_family, "cox")
        self.assertTrue(any("Reduced the Cox predictor set" in warning for warning in response.warnings))

    def test_time_to_resolution_receipt_uses_resolution_event_and_keeps_censored_rows(self) -> None:
        adsl_rows = ["USUBJID,TRT01A,AGE,SEX,RACE"]
        adae_rows = ["USUBJID,AETERM,AETOXGR,AESTDY,AEENDY"]
        adex_rows = ["USUBJID,EXSTDY,EXENDY,EXDOSE"]
        for index in range(1, 13):
            treatment = "Enhanced DM" if index <= 6 else "SoC DM"
            adsl_rows.append(f"{index:02d},{treatment},{58 + index},{'F' if index % 2 == 0 else 'M'},{'ASIAN' if index % 3 else 'WHITE'}")
            ae_end = "" if index in {3, 9} else str(16 + index)
            adae_rows.append(f"{index:02d},Rash,{2 if index % 4 else 3},{6 + index},{ae_end}")
            adex_rows.append(f"{index:02d},1,{26 + index},{700 if index <= 6 else 1050}")

        datasets = [
            DatasetReference(
                file_id="adsl_resolution",
                name="adsl_resolution.csv",
                role="ADSL",
                column_names=["USUBJID", "TRT01A", "AGE", "SEX", "RACE"],
                content="\n".join(adsl_rows),
            ),
            DatasetReference(
                file_id="adae_resolution",
                name="adae_resolution.csv",
                role="ADAE",
                column_names=["USUBJID", "AETERM", "AETOXGR", "AESTDY", "AEENDY"],
                content="\n".join(adae_rows),
            ),
            DatasetReference(
                file_id="adex_resolution",
                name="adex_resolution.csv",
                role="ADEX",
                column_names=["USUBJID", "EXSTDY", "EXENDY", "EXDOSE"],
                content="\n".join(adex_rows),
            ),
        ]

        service = AnalysisService()
        response = service.run_analysis(
            AnalysisRunRequest(
                question=(
                    "Among participants who develop Grade >=2 DAEIs, what factors predict time to resolution "
                    "(faster vs slower recovery), and do these predictors differ by arm?"
                ),
                datasets=datasets,
            )
        )

        self.assertTrue(response.executed)
        self.assertEqual(response.analysis_family, "cox")
        self.assertIsNotNone(response.receipt)
        self.assertEqual(response.receipt.outcome_variable, "AE_RESOLUTION_EVENT")
        metric_map = {metric.name: metric.value for metric in response.metrics}
        self.assertEqual(metric_map.get("subjects_used"), 12)
        self.assertEqual(metric_map.get("non_event_subjects"), 2)
        self.assertFalse(any("did not include censored subjects" in warning for warning in response.warnings))


if __name__ == "__main__":
    unittest.main()
