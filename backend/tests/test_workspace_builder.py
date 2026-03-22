import unittest

from backend.app.models.analysis import DatasetReference
from backend.app.services.workspace_builder import build_workspace, infer_role


class WorkspaceBuilderTests(unittest.TestCase):
    def test_infer_role_accepts_participant_id_labs_shape(self) -> None:
        dataset = DatasetReference(
            file_id="labs",
            name="baseline_labs.csv",
            column_names=["PARTICIPANT_ID", "PARAM", "AVAL", "ABLFL"],
            content="PARTICIPANT_ID,PARAM,AVAL,ABLFL\nP-01,ALB,3.4,Y",
        )
        self.assertEqual(infer_role(dataset), "ADLB")

    def test_build_workspace_blocks_duplicate_singleton_roles(self) -> None:
        datasets = [
            DatasetReference(
                file_id="adsl_1",
                name="raw_demographics.csv",
                role="DEMOGRAPHICS",
                column_names=["USUBJID", "TRT01A", "AGE", "SEX"],
                content="USUBJID,TRT01A,AGE,SEX\n01,A,65,F",
            ),
            DatasetReference(
                file_id="adsl_2",
                name="adsl.csv",
                role="ADSL",
                column_names=["USUBJID", "TRT01A", "AGE", "SEX"],
                content="USUBJID,TRT01A,AGE,SEX\n01,A,65,F",
            ),
        ]

        with self.assertRaisesRegex(ValueError, "Multiple selected datasets map to the same required analysis role"):
            build_workspace("Compare incidence by treatment", datasets, None)


if __name__ == "__main__":
    unittest.main()
