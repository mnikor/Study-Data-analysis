from __future__ import annotations

import re
from dataclasses import dataclass
from io import StringIO
from typing import Iterable

import pandas as pd

from ..models.analysis import AnalysisFilter, AnalysisSpec, DatasetReference


ROLE_HINTS: tuple[tuple[str, str], ...] = (
    ("adsl", "ADSL"),
    ("adae", "ADAE"),
    ("adlb", "ADLB"),
    ("adtte", "ADTTE"),
    ("adverse_events", "ADAE"),
    ("labs", "ADLB"),
    ("demographics", "ADSL"),
    ("dm", "ADSL"),
    ("ae", "ADAE"),
    ("lb", "ADLB"),
    ("adex", "ADEX"),
    ("exposure", "EX"),
    ("ds", "DS"),
    ("disposition", "DS"),
    ("compliance", "DS"),
)

SUBJECT_ID_HINTS = ("USUBJID", "SUBJID", "SUBJECT_ID", "PATIENT_ID", "PARTICIPANT_ID", "PARTICIPANTID", "PARTICIPANT")
TREATMENT_HINTS = ("TRT01A", "TRTA", "TRT01P", "ACTARM", "ARM", "TRT_ARM", "TREATMENT_ARM")
AGE_HINTS = ("AGE", "AGEYRS", "AGE_YRS")
WEIGHT_HINTS = ("WEIGHT", "WT", "WTBL", "BASEWT", "WGT", "WEIGHTBL")
SEX_HINTS = ("SEX", "GENDER")
RACE_HINTS = ("RACE", "ETHNIC", "ETHNICITY")
GRADE_HINTS = ("AETOXGR", "AEGRADE", "GRADE", "SEVERITY_GRADE")
DAY_HINTS = ("AESTDY", "ASTDY", "ADY", "DAY", "DY")
AE_END_DAY_HINTS = ("AEENDY", "AENDY", "ENDDY", "AERESDY", "RESDY")
AE_DURATION_HINTS = ("AEDUR", "DURATION", "AE_DURATION", "DUR")
TERM_HINTS = ("AEDECOD", "AETERM", "PT", "TERM")
PARAM_HINTS = ("PARAMCD", "PARAM", "LBTESTCD", "LBTEST", "TESTCD", "TEST")
VALUE_HINTS = ("AVAL", "LBSTRESN", "RESULT", "VALUE")
DOSE_HINTS = ("DOSE", "DOSEMG", "DOSE_LEVEL", "EXDOSE", "ADEXDOSE", "DOSEAMT", "DOSEA")
EXPOSURE_START_DAY_HINTS = ("EXSTDY", "EXSTDTC", "STARTDY", "DOSEDY")
EXPOSURE_END_DAY_HINTS = ("EXENDY", "ENDDY", "LASTDOSEDY")
BASELINE_FLAG_HINTS = ("ABLFL", "BASELINEFL")
BASELINE_VISIT_HINTS = ("AVISIT", "VISIT", "VISIT_NAME")
REPEATED_TIME_HINTS = ("AVISITN", "VISITNUM", "VISITDY", "ADY", "DY", "AVISIT", "VISIT", "AESTDY")
TIME_HINTS = ("AVAL", "TIME", "OS_TIME", "PFS_TIME", "ADTTE", "DTHDY", "ADT")
CENSOR_HINTS = ("CNSR", "CENSOR", "CENSORING", "STATUS", "EVENT", "EVENTFL", "OS_EVENT", "PFS_EVENT")
DISPOSITION_TERM_HINTS = ("DSTERM", "DSDECOD", "STATUS", "TERM", "DECOD")
DISPOSITION_DAY_HINTS = ("DSSTDY", "DSDY", "DAY", "DY")


@dataclass
class BuiltWorkspace:
    dataframe: pd.DataFrame
    source_names: list[str]
    notes: list[str]
    derived_columns: list[str]
    metadata: dict[str, str | int | list[str] | None]


def infer_role(dataset: DatasetReference) -> str | None:
    if dataset.role:
        normalized_role = dataset.role.upper()
        role_aliases = {
            "DEMOGRAPHICS": "ADSL",
            "DM": "ADSL",
            "ADVERSE_EVENTS": "ADAE",
            "AE": "ADAE",
            "LABS": "ADLB",
            "LB": "ADLB",
            "DISPOSITION": "DS",
            "DS": "DS",
        }
        return role_aliases.get(normalized_role, normalized_role)

    inferred_from_headers = _infer_role_from_columns(dataset.column_names)
    if inferred_from_headers:
        return inferred_from_headers

    name = dataset.name.lower()
    for token, role in ROLE_HINTS:
        if token in name:
            return role
    return None


def _has_any_column(columns: list[str], hints: tuple[str, ...]) -> bool:
    normalized = [_normalize_token(column) for column in columns]
    for hint in hints:
        needle = _normalize_token(hint)
        if any(token == needle or needle in token for token in normalized):
            return True
    return False


def _infer_role_from_columns(columns: list[str]) -> str | None:
    if not columns:
        return None

    if (
        _has_any_column(columns, SUBJECT_ID_HINTS)
        and _has_any_column(columns, TIME_HINTS)
        and _has_any_column(columns, CENSOR_HINTS)
    ):
        return "ADTTE"

    if (
        _has_any_column(columns, SUBJECT_ID_HINTS)
        and _has_any_column(columns, TREATMENT_HINTS)
        and _has_any_column(columns, AGE_HINTS + SEX_HINTS)
    ):
        return "ADSL"

    if (
        _has_any_column(columns, SUBJECT_ID_HINTS)
        and _has_any_column(columns, TERM_HINTS)
        and (_has_any_column(columns, GRADE_HINTS) or _has_any_column(columns, DAY_HINTS))
    ):
        return "ADAE"

    if (
        _has_any_column(columns, SUBJECT_ID_HINTS)
        and _has_any_column(columns, PARAM_HINTS)
        and _has_any_column(columns, VALUE_HINTS)
    ):
        return "ADLB"

    if _has_any_column(columns, SUBJECT_ID_HINTS) and _has_any_column(columns, DISPOSITION_TERM_HINTS):
        return "DS"

    return None


def build_workspace(question: str, datasets: Iterable[DatasetReference], spec: AnalysisSpec | None) -> BuiltWorkspace:
    dataset_list = list(datasets)
    role_buckets: dict[str, list[DatasetReference]] = {}
    for dataset in dataset_list:
        inferred_role = infer_role(dataset)
        if inferred_role:
            role_buckets.setdefault(inferred_role, []).append(dataset)

    singleton_roles = {"ADSL", "ADAE", "ADLB", "ADTTE", "ADEX", "EX", "DS"}
    duplicate_roles = {
        role: [dataset.name for dataset in matched]
        for role, matched in role_buckets.items()
        if role in singleton_roles and len(matched) > 1
    }
    if duplicate_roles:
        formatted = "; ".join(f"{role}: {', '.join(names)}" for role, names in duplicate_roles.items())
        raise ValueError(
            "Multiple selected datasets map to the same required analysis role. "
            f"Deselect extras or keep one file per role before execution. Conflicts: {formatted}"
        )

    dataset_map = {role: matched[0] for role, matched in role_buckets.items()}

    adsl = dataset_map.get("ADSL")
    adae = dataset_map.get("ADAE")
    adlb = dataset_map.get("ADLB")
    adtte = dataset_map.get("ADTTE")
    adex = dataset_map.get("ADEX") or dataset_map.get("EX")
    ds = dataset_map.get("DS")

    if _requires_repeated_workspace(question, spec):
        if adsl is None or (adlb is None and adae is None):
            raise ValueError("A repeated-measures workspace requires ADSL plus ADLB or ADAE with repeated rows.")
        return _build_repeated_measures_workspace(question, dataset_list, adsl, adlb, adae, spec)

    if _requires_competing_risks_workspace(question, spec):
        if adsl is None or ds is None:
            raise ValueError("A competing-risks workspace requires ADSL plus disposition/compliance timing data.")
        return _build_competing_risks_workspace(question, dataset_list, adsl, adae, adlb, adex, ds, spec)

    if _requires_survival_workspace(question, spec):
        if adtte is None and (adsl is None or adae is None):
            missing = ["ADTTE"] if adtte is None else []
            raise ValueError(
                "A Kaplan-Meier or Cox analysis requires either an ADTTE dataset or an ADSL + ADAE combination with a derivable AE endpoint."
                if missing
                else "A survival workspace could not be derived from the selected datasets."
            )
        return _build_survival_workspace(question, dataset_list, adsl, adae, adtte, adlb, adex, spec)

    if adsl is None or adae is None:
        missing = [role for role, dataset in (("ADSL", adsl), ("ADAE", adae)) if dataset is None]
        raise ValueError(f"Missing required dataset roles: {', '.join(missing)}")

    return _build_ae_workspace(question, dataset_list, adsl, adae, adlb, adex, ds, spec)


def _build_ae_workspace(
    question: str,
    dataset_list: list[DatasetReference],
    adsl: DatasetReference,
    adae: DatasetReference,
    adlb: DatasetReference | None,
    adex: DatasetReference | None,
    ds: DatasetReference | None,
    spec: AnalysisSpec | None,
) -> BuiltWorkspace:
    adsl_df = _read_csv_dataset(adsl)
    adae_df = _read_csv_dataset(adae)
    adlb_df = _read_csv_dataset(adlb) if adlb else None
    adex_df = _read_csv_dataset(adex) if adex else None
    ds_df = _read_csv_dataset(ds) if ds else None

    notes: list[str] = []
    source_names = [dataset.name for dataset in dataset_list]

    subject_id_col = _find_column(adsl_df, SUBJECT_ID_HINTS)
    if subject_id_col is None:
        raise ValueError("ADSL dataset must contain a subject identifier such as USUBJID.")

    treatment_col = (spec.treatment_variable if spec and spec.treatment_variable in adsl_df.columns else None) or _find_column(
        adsl_df, TREATMENT_HINTS
    )
    if treatment_col is None:
        raise ValueError("ADSL dataset must contain a treatment/grouping column such as TRT01A or ARM.")

    adsl_subject = adsl_df.dropna(subset=[subject_id_col]).drop_duplicates(subset=[subject_id_col], keep="first").copy()
    adsl_subject, filter_notes = _apply_cohort_filters(adsl_subject, spec)
    notes.extend(filter_notes)

    ae_subject, ae_metadata, ae_notes = _derive_ae_subject_summary(question, adae_df, spec)
    notes.extend(ae_notes)

    workspace = adsl_subject.merge(
        ae_subject,
        how="left",
        left_on=subject_id_col,
        right_on=ae_metadata["subject_id_column"],
        suffixes=("", "_AE"),
    )

    ae_join_key = ae_metadata["subject_id_column"]
    if isinstance(ae_join_key, str) and ae_join_key != subject_id_col and ae_join_key in workspace.columns:
        workspace = workspace.drop(columns=[ae_join_key])

    derived_columns = [column for column in workspace.columns if column.startswith("AE_")]

    baseline_features, baseline_notes = _derive_adsl_baseline_features(adsl_subject)
    notes.extend(baseline_notes)
    if not baseline_features.empty:
        baseline_join_key = baseline_features.columns[0]
        workspace = workspace.merge(baseline_features, how="left", left_on=subject_id_col, right_on=baseline_join_key)
        if baseline_join_key != subject_id_col and baseline_join_key in workspace.columns:
            workspace = workspace.drop(columns=[baseline_join_key])
        derived_columns.extend([column for column in workspace.columns if column.startswith("EX_")])

    if adlb_df is not None:
        lab_features, lab_notes = _derive_lab_features(adlb_df)
        notes.extend(lab_notes)
        if not lab_features.empty:
            lab_join_key = lab_features.columns[0]
            workspace = workspace.merge(lab_features, how="left", left_on=subject_id_col, right_on=lab_join_key)
            if lab_join_key != subject_id_col and lab_join_key in workspace.columns:
                workspace = workspace.drop(columns=[lab_join_key])
            derived_columns.extend([column for column in workspace.columns if column.startswith("LAB_")])

    if adex_df is not None:
        exposure_features, exposure_notes = _derive_exposure_features(adex_df)
        notes.extend(exposure_notes)
        if not exposure_features.empty:
            exposure_join_key = exposure_features.columns[0]
            workspace = workspace.merge(exposure_features, how="left", left_on=subject_id_col, right_on=exposure_join_key)
            if exposure_join_key != subject_id_col and exposure_join_key in workspace.columns:
                workspace = workspace.drop(columns=[exposure_join_key])
            derived_columns.extend([column for column in workspace.columns if column.startswith("EX_")])

    if ds_df is not None:
        disposition_features, disposition_notes = _derive_disposition_features(ds_df)
        notes.extend(disposition_notes)
        if not disposition_features.empty:
            disposition_join_key = disposition_features.columns[0]
            workspace = workspace.merge(disposition_features, how="left", left_on=subject_id_col, right_on=disposition_join_key)
            if disposition_join_key != subject_id_col and disposition_join_key in workspace.columns:
                workspace = workspace.drop(columns=[disposition_join_key])
            derived_columns.extend([column for column in workspace.columns if column.startswith("DS_")])

    if "AE_OUTCOME_FLAG" in workspace.columns:
        workspace["AE_OUTCOME_FLAG"] = pd.to_numeric(workspace["AE_OUTCOME_FLAG"], errors="coerce").fillna(0).astype(int)
    if "AE_QUALIFYING_EVENT_COUNT" in workspace.columns:
        workspace["AE_QUALIFYING_EVENT_COUNT"] = pd.to_numeric(
            workspace["AE_QUALIFYING_EVENT_COUNT"], errors="coerce"
        ).fillna(0).astype(int)
    if "AE_FIRST_QUALIFYING_DAY" in workspace.columns:
        workspace["AE_TIME_TO_EVENT"] = pd.to_numeric(workspace["AE_FIRST_QUALIFYING_DAY"], errors="coerce")
        censor_time = ae_metadata.get("time_window_days") or ae_metadata.get("max_observed_day")
        if "EX_LAST_EXPOSURE_DAY" in workspace.columns:
            exposure_censor = pd.to_numeric(workspace["EX_LAST_EXPOSURE_DAY"], errors="coerce")
            workspace.loc[workspace["AE_OUTCOME_FLAG"] == 0, "AE_TIME_TO_EVENT"] = exposure_censor
        if censor_time is not None:
            workspace["AE_TIME_TO_EVENT"] = workspace["AE_TIME_TO_EVENT"].fillna(float(censor_time))
            workspace.loc[workspace["AE_OUTCOME_FLAG"] == 0, "AE_TIME_TO_EVENT"] = workspace.loc[
                workspace["AE_OUTCOME_FLAG"] == 0, "AE_TIME_TO_EVENT"
            ].fillna(float(censor_time))
        workspace["AE_EVENT_INDICATOR"] = workspace["AE_OUTCOME_FLAG"]
        derived_columns.extend(["AE_TIME_TO_EVENT", "AE_EVENT_INDICATOR"])

    resolution_time_column = None
    resolution_event_column = None
    if "AE_TIME_TO_RESOLUTION" in workspace.columns:
        workspace["AE_TIME_TO_RESOLUTION"] = pd.to_numeric(workspace["AE_TIME_TO_RESOLUTION"], errors="coerce")
        workspace["AE_RESOLUTION_EVENT"] = pd.to_numeric(workspace["AE_RESOLUTION_EVENT"], errors="coerce").fillna(0).astype(int)
        resolution_censor_source = pd.Series([float("nan")] * len(workspace), index=workspace.index, dtype="float64")
        if "EX_LAST_EXPOSURE_DAY" in workspace.columns:
            resolution_censor_source = pd.to_numeric(workspace["EX_LAST_EXPOSURE_DAY"], errors="coerce")
        if resolution_censor_source.isna().all() and ae_metadata.get("max_followup_day") is not None:
            resolution_censor_source = pd.Series(
                [float(ae_metadata["max_followup_day"])] * len(workspace), index=workspace.index, dtype="float64"
            )
        if "AE_FIRST_QUALIFYING_DAY_DETAIL" in workspace.columns:
            onset_day = pd.to_numeric(workspace["AE_FIRST_QUALIFYING_DAY_DETAIL"], errors="coerce")
        else:
            onset_day = pd.to_numeric(workspace.get("AE_FIRST_QUALIFYING_DAY"), errors="coerce")
        unresolved_mask = workspace["AE_RESOLUTION_EVENT"] == 0
        if unresolved_mask.any():
            censor_duration = resolution_censor_source - onset_day
            censor_duration = pd.to_numeric(censor_duration, errors="coerce")
            censor_duration = censor_duration.where(censor_duration > 0)
            workspace.loc[unresolved_mask & workspace["AE_TIME_TO_RESOLUTION"].isna(), "AE_TIME_TO_RESOLUTION"] = censor_duration
        resolution_time_column = "AE_TIME_TO_RESOLUTION"
        resolution_event_column = "AE_RESOLUTION_EVENT"
        derived_columns.extend(["AE_TIME_TO_RESOLUTION", "AE_RESOLUTION_EVENT"])

    survival_time_column = "AE_TIME_TO_EVENT" if "AE_TIME_TO_EVENT" in workspace.columns else None
    survival_event_column = "AE_EVENT_INDICATOR" if "AE_EVENT_INDICATOR" in workspace.columns else None
    if spec and spec.target_definition == "time_to_resolution_grade_2_plus_dae":
        if resolution_time_column is None or resolution_event_column is None:
            raise ValueError(
                "A time-to-resolution analysis requires AE end-day or duration fields such as AEENDY or AEDUR in ADAE."
            )
        workspace = workspace[workspace["AE_OUTCOME_FLAG"] == 1].copy()
        survival_time_column = resolution_time_column
        survival_event_column = resolution_event_column
        notes.append("Filtered workspace to subjects with qualifying adverse events for time-to-resolution modeling and preserved unresolved qualifying events as censored rows when follow-up timing was available.")
    elif spec and spec.target_definition == "later_treatment_discontinuation":
        if "DS_DISCONTINUATION_FLAG" not in workspace.columns:
            raise ValueError(
                "A treatment persistence analysis requires a disposition/compliance dataset with discontinuation or interruption terms."
            )
        if spec.time_window_days is not None and "AE_FIRST_QUALIFYING_DAY" in workspace.columns:
            workspace["AE_EARLY_EVENT_FLAG"] = (
                pd.to_numeric(workspace["AE_FIRST_QUALIFYING_DAY"], errors="coerce") <= spec.time_window_days
            ).fillna(False).astype(int)
            notes.append(f"Derived early-event flag using AE first qualifying day <= {spec.time_window_days}.")
        else:
            workspace["AE_EARLY_EVENT_FLAG"] = workspace["AE_OUTCOME_FLAG"]
        workspace["AE_OUTCOME_FLAG"] = pd.to_numeric(workspace["DS_DISCONTINUATION_FLAG"], errors="coerce").fillna(0).astype(int)
        derived_columns.append("AE_EARLY_EVENT_FLAG")
        notes.append("Using derived discontinuation/interruption endpoint as the binary outcome.")
    elif spec and spec.target_definition == "time_to_first_grade_2_plus_dae" and survival_time_column is not None:
        notes.append("Using derived AE onset fields for time-to-first-event modeling.")

    competing_time_column = None
    competing_event_column = None
    if "DS_FIRST_DISCONTINUATION_DAY" in workspace.columns or "DS_FIRST_DEATH_DAY" in workspace.columns:
        discontinuation_day = pd.to_numeric(
            workspace["DS_FIRST_DISCONTINUATION_DAY"] if "DS_FIRST_DISCONTINUATION_DAY" in workspace.columns else pd.Series([pd.NA] * len(workspace), index=workspace.index),
            errors="coerce",
        )
        death_day = pd.to_numeric(
            workspace["DS_FIRST_DEATH_DAY"] if "DS_FIRST_DEATH_DAY" in workspace.columns else pd.Series([pd.NA] * len(workspace), index=workspace.index),
            errors="coerce",
        )
        fallback_censor = pd.to_numeric(
            workspace["EX_LAST_EXPOSURE_DAY"] if "EX_LAST_EXPOSURE_DAY" in workspace.columns else pd.Series([pd.NA] * len(workspace), index=workspace.index),
            errors="coerce",
        )
        if fallback_censor.isna().all() and ae_metadata.get("max_observed_day") is not None:
            fallback_censor = pd.Series([float(ae_metadata["max_observed_day"])] * len(workspace), index=workspace.index)
        if fallback_censor.isna().all():
            fallback_value = float(spec.time_window_days) if spec and spec.time_window_days is not None else 1.0
            fallback_censor = pd.Series([fallback_value] * len(workspace), index=workspace.index)

        event_code = pd.Series([0] * len(workspace), index=workspace.index, dtype="int64")
        event_time = fallback_censor.copy()

        discontinuation_first = discontinuation_day.notna() & (death_day.isna() | (discontinuation_day <= death_day))
        death_first = death_day.notna() & (discontinuation_day.isna() | (death_day < discontinuation_day))

        event_code.loc[discontinuation_first] = 1
        event_code.loc[death_first] = 2
        event_time.loc[discontinuation_first] = discontinuation_day.loc[discontinuation_first]
        event_time.loc[death_first] = death_day.loc[death_first]

        workspace["COMPETING_EVENT_CODE"] = event_code
        workspace["COMPETING_EVENT_TIME"] = pd.to_numeric(event_time, errors="coerce")
        competing_event_column = "COMPETING_EVENT_CODE"
        competing_time_column = "COMPETING_EVENT_TIME"
        derived_columns.extend(["COMPETING_EVENT_CODE", "COMPETING_EVENT_TIME"])
        notes.append("Derived competing-risk event codes using discontinuation as the event of interest and death as the competing event.")

    metadata: dict[str, str | int | list[str] | None] = {
        "subject_id_column": subject_id_col,
        "treatment_column": treatment_col,
        "outcome_column": resolution_event_column if spec and spec.target_definition == "time_to_resolution_grade_2_plus_dae" else "AE_OUTCOME_FLAG",
        "survival_time_column": survival_time_column,
        "survival_event_column": survival_event_column,
        "competing_time_column": competing_time_column,
        "competing_event_column": competing_event_column,
        "time_window_days": ae_metadata.get("time_window_days"),
        "grade_threshold": ae_metadata.get("grade_threshold"),
        "term_filters": ae_metadata.get("term_filters"),
        "max_observed_day": ae_metadata.get("max_observed_day"),
        "target_definition": spec.target_definition if spec else None,
        "cohort_filter_labels": _cohort_filter_labels(spec),
        "cohort_subject_count": int(workspace.shape[0]),
    }

    notes.append(f"Workspace built from {len(source_names)} dataset(s) with {workspace.shape[0]} subject rows.")

    return BuiltWorkspace(
        dataframe=workspace,
        source_names=source_names,
        notes=notes,
        derived_columns=sorted(set(derived_columns)),
        metadata=metadata,
    )


def _read_csv_dataset(dataset: DatasetReference) -> pd.DataFrame:
    if not dataset.content or not dataset.content.strip():
        raise ValueError(f"Dataset {dataset.name} is missing inline content.")
    return pd.read_csv(StringIO(dataset.content), dtype=str).fillna("")


def _normalize_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _requires_survival_workspace(question: str, spec: AnalysisSpec | None) -> bool:
    if spec is not None:
        return spec.analysis_family in {"kaplan_meier", "cox"}

    lower_question = question.lower()
    return any(token in lower_question for token in ("kaplan", "survival", "hazard", "cox", "time-to-event", "time to event"))


def _requires_repeated_workspace(question: str, spec: AnalysisSpec | None) -> bool:
    if spec is not None:
        return spec.analysis_family == "mixed_model"
    lower_question = question.lower()
    return any(token in lower_question for token in ("repeated measures", "repeated-measures", "longitudinal", "mixed model", "trajectory", "trend over time", "visit-level", "repeated visit"))


def _requires_competing_risks_workspace(question: str, spec: AnalysisSpec | None) -> bool:
    if spec is not None:
        return spec.analysis_family == "competing_risks"
    lower_question = question.lower()
    return any(token in lower_question for token in ("competing risk", "competing risks"))


def _find_column(frame: pd.DataFrame, hints: tuple[str, ...]) -> str | None:
    normalized = {column: _normalize_token(column) for column in frame.columns}
    for hint in hints:
        needle = _normalize_token(hint)
        for column, token in normalized.items():
            if token == needle:
                return column
        for column, token in normalized.items():
            if needle in token:
                return column
    return None


def _apply_cohort_filters(frame: pd.DataFrame, spec: AnalysisSpec | None) -> tuple[pd.DataFrame, list[str]]:
    if spec is None or not spec.cohort_filters:
        return frame, []

    field_columns = {
        "AGE": _find_column(frame, AGE_HINTS),
        "SEX": _find_column(frame, SEX_HINTS),
        "RACE": _find_column(frame, RACE_HINTS),
    }
    filtered = frame.copy()
    notes: list[str] = []
    starting_rows = int(filtered.shape[0])

    for cohort_filter in spec.cohort_filters:
        column = field_columns.get(cohort_filter.field.upper())
        if column is None:
            notes.append(f"Skipped cohort filter '{cohort_filter.label or cohort_filter.field}' because no matching ADSL column was detected.")
            continue

        mask = _build_filter_mask(filtered[column], cohort_filter)
        before_rows = int(filtered.shape[0])
        filtered = filtered.loc[mask].copy()
        notes.append(
            f"Applied cohort filter {cohort_filter.label or cohort_filter.field} on {column}: {before_rows} -> {int(filtered.shape[0])} subjects."
        )

    notes.append(f"Cohort filtering retained {int(filtered.shape[0])} of {starting_rows} subject rows.")
    return filtered, notes


def _cohort_filter_labels(spec: AnalysisSpec | None) -> list[str]:
    if spec is None or not spec.cohort_filters:
        return []
    labels = [cohort_filter.label or f"{cohort_filter.field} {cohort_filter.operator} {cohort_filter.value}" for cohort_filter in spec.cohort_filters]
    summary = _summarize_cohort_filters(spec)
    if summary:
        return [summary, *labels]
    return labels


def _summarize_cohort_filters(spec: AnalysisSpec | None) -> str | None:
    if spec is None or not spec.cohort_filters:
        return None

    race_value = None
    sex_value = None
    age_gte = None
    age_lte = None

    for cohort_filter in spec.cohort_filters:
        field = cohort_filter.field.upper()
        operator = cohort_filter.operator
        value = cohort_filter.value.strip()
        if field == "RACE" and operator in {"contains", "equals"}:
            race_value = value.title()
        elif field == "SEX" and operator == "equals":
            lowered = value.lower()
            if lowered in {"f", "female"}:
                sex_value = "women"
            elif lowered in {"m", "male"}:
                sex_value = "men"
        elif field == "AGE" and operator == "gte":
            age_gte = value
        elif field == "AGE" and operator == "lte":
            age_lte = value

    parts: list[str] = []
    if race_value:
        parts.append(race_value)
    if sex_value:
        parts.append(sex_value)
    if age_gte:
        parts.append(f">={age_gte}")
    elif age_lte:
        parts.append(f"<={age_lte}")

    if not parts:
        return None
    return " ".join(parts)


def _build_filter_mask(series: pd.Series, cohort_filter: AnalysisFilter) -> pd.Series:
    normalized = series.astype(str).str.strip()
    operator = cohort_filter.operator
    value = cohort_filter.value.strip()

    if operator == "contains":
        return normalized.str.lower().str.contains(value.lower(), na=False)

    if operator == "equals":
        if cohort_filter.field.upper() == "SEX" and value.lower() in {"f", "m"}:
            sex_aliases = {"f": {"f", "female"}, "m": {"m", "male"}}
            aliases = sex_aliases[value.lower()]
            return normalized.str.lower().isin(aliases)
        return normalized.str.lower() == value.lower()

    numeric = pd.to_numeric(series, errors="coerce")
    threshold = pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0]
    if pd.isna(threshold):
        return pd.Series([False] * len(series), index=series.index)

    if operator == "gte":
        return numeric >= threshold
    if operator == "lte":
        return numeric <= threshold

    return pd.Series([True] * len(series), index=series.index)


def _parse_grade_threshold(question: str, spec: AnalysisSpec | None) -> int:
    if spec and spec.grade_threshold is not None:
        return spec.grade_threshold
    match = re.search(r"grade\s*(?:>=|≥)?\s*(\d+)", question.lower())
    if match:
        return int(match.group(1))
    return 2


def _parse_term_filters(question: str, spec: AnalysisSpec | None) -> list[str]:
    if spec and spec.term_filters:
        return [term.lower() for term in spec.term_filters]

    text = question.lower()
    if "dermat" in text or "rash" in text or "skin" in text:
        return ["rash", "dermat", "erythema", "prur", "skin", "dermatologic"]
    return []


def _derive_ae_subject_summary(
    question: str,
    adae_df: pd.DataFrame,
    spec: AnalysisSpec | None,
) -> tuple[pd.DataFrame, dict[str, str | int | list[str] | None], list[str]]:
    subject_id_col = _find_column(adae_df, SUBJECT_ID_HINTS)
    grade_col = (spec.event_variable if spec and spec.event_variable in adae_df.columns else None) or _find_column(
        adae_df, GRADE_HINTS
    )
    day_col = (spec.time_variable if spec and spec.time_variable in adae_df.columns else None) or _find_column(
        adae_df, DAY_HINTS
    )
    end_day_col = _find_column(adae_df, AE_END_DAY_HINTS)
    duration_col = _find_column(adae_df, AE_DURATION_HINTS)
    term_col = _find_column(adae_df, TERM_HINTS)

    if subject_id_col is None:
        raise ValueError("ADAE dataset must contain a subject identifier such as USUBJID.")
    if grade_col is None:
        raise ValueError("ADAE dataset must contain an event grade column such as AETOXGR or GRADE.")

    grade_threshold = _parse_grade_threshold(question, spec)
    time_window_days = spec.time_window_days if spec and spec.time_window_days is not None else (
        84 if "week 12" in question.lower() else None
    )
    term_filters = _parse_term_filters(question, spec)

    frame = adae_df.copy()
    frame["__GRADE_NUM__"] = pd.to_numeric(frame[grade_col], errors="coerce")
    qualifies = frame["__GRADE_NUM__"] >= grade_threshold

    notes: list[str] = [f"Derived qualifying adverse events using {grade_col} >= {grade_threshold}."]

    if day_col is not None:
        frame["__DAY_NUM__"] = pd.to_numeric(frame[day_col], errors="coerce")
    else:
        frame["__DAY_NUM__"] = pd.NA

    if time_window_days is not None:
        if day_col is None:
            raise ValueError("A time-windowed adverse event analysis requires an event timing column such as AESTDY.")
        qualifies = qualifies & (frame["__DAY_NUM__"] <= time_window_days)
        notes.append(f"Applied event time window {day_col} <= {time_window_days}.")

    if end_day_col is not None:
        frame["__END_DAY_NUM__"] = pd.to_numeric(frame[end_day_col], errors="coerce")
    else:
        frame["__END_DAY_NUM__"] = pd.NA
    if duration_col is not None:
        frame["__DURATION_NUM__"] = pd.to_numeric(frame[duration_col], errors="coerce")
    else:
        frame["__DURATION_NUM__"] = pd.NA

    if term_filters and term_col is not None:
        lower_terms = frame[term_col].astype(str).str.lower()
        qualifies = qualifies & lower_terms.apply(lambda value: any(term in value for term in term_filters))
        notes.append(f"Applied term-level filter on {term_col}: {', '.join(term_filters)}.")
    elif term_filters and term_col is None:
        notes.append("Question requested term-level filtering, but no event term column was detected in ADAE.")

    qualifying = frame.loc[qualifies].copy()
    if not qualifying.empty and day_col is not None:
        qualifying = qualifying.sort_values(by=["__DAY_NUM__"], na_position="last")

    subject_summary = (
        qualifying.groupby(subject_id_col, dropna=False)
        .agg(
            AE_OUTCOME_FLAG=(subject_id_col, lambda values: 1),
            AE_QUALIFYING_EVENT_COUNT=(subject_id_col, "size"),
            AE_FIRST_QUALIFYING_DAY=("__DAY_NUM__", "min"),
        )
        .reset_index()
    )

    if not qualifying.empty:
        first_event = qualifying.groupby(subject_id_col, dropna=False).first().reset_index()
        first_event = first_event.rename(
            columns={
                "__GRADE_NUM__": "AE_FIRST_QUALIFYING_GRADE",
                "__DAY_NUM__": "AE_FIRST_QUALIFYING_DAY_DETAIL",
            }
        )
        merge_columns = [subject_id_col, "AE_FIRST_QUALIFYING_GRADE"]
        if term_col and term_col in first_event.columns:
            first_event = first_event.rename(columns={term_col: "AE_FIRST_QUALIFYING_TERM"})
            merge_columns.append("AE_FIRST_QUALIFYING_TERM")

        first_event["AE_TIME_TO_RESOLUTION"] = pd.NA
        first_event["AE_RESOLUTION_EVENT"] = 0
        if day_col is not None and end_day_col is not None:
            first_event["AE_TIME_TO_RESOLUTION"] = first_event["__END_DAY_NUM__"] - first_event["AE_FIRST_QUALIFYING_DAY_DETAIL"]
            resolution_numeric = pd.to_numeric(first_event["AE_TIME_TO_RESOLUTION"], errors="coerce")
            first_event.loc[resolution_numeric < 0, "AE_TIME_TO_RESOLUTION"] = pd.NA
            first_event["AE_RESOLUTION_EVENT"] = first_event["AE_TIME_TO_RESOLUTION"].notna().astype(int)
        elif duration_col is not None:
            first_event["AE_TIME_TO_RESOLUTION"] = first_event["__DURATION_NUM__"]
            first_event["AE_RESOLUTION_EVENT"] = first_event["AE_TIME_TO_RESOLUTION"].notna().astype(int)

        merge_columns.extend(["AE_TIME_TO_RESOLUTION", "AE_RESOLUTION_EVENT"])
        subject_summary = subject_summary.merge(first_event[merge_columns], how="left", on=subject_id_col)

    metadata = {
        "subject_id_column": subject_id_col,
        "grade_threshold": grade_threshold,
        "time_window_days": time_window_days,
        "term_filters": term_filters,
        "max_observed_day": int(frame["__DAY_NUM__"].max()) if day_col is not None and frame["__DAY_NUM__"].notna().any() else None,
        "max_followup_day": int(frame["__END_DAY_NUM__"].max())
        if end_day_col is not None and frame["__END_DAY_NUM__"].notna().any()
        else int(frame["__DAY_NUM__"].max())
        if day_col is not None and frame["__DAY_NUM__"].notna().any()
        else None,
    }
    return subject_summary, metadata, notes


def _derive_lab_features(adlb_df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    subject_id_col = _find_column(adlb_df, SUBJECT_ID_HINTS)
    param_col = _find_column(adlb_df, PARAM_HINTS)
    value_col = _find_column(adlb_df, VALUE_HINTS)
    baseline_flag_col = _find_column(adlb_df, BASELINE_FLAG_HINTS)
    baseline_visit_col = _find_column(adlb_df, BASELINE_VISIT_HINTS)

    if subject_id_col is None or param_col is None or value_col is None:
        return pd.DataFrame(), [
            "ADLB was provided but did not expose subject, parameter, and numeric value columns for baseline feature derivation."
        ]

    frame = adlb_df.copy()
    frame["__VALUE_NUM__"] = pd.to_numeric(frame[value_col], errors="coerce")
    frame = frame.dropna(subset=["__VALUE_NUM__"])

    if baseline_flag_col and baseline_flag_col in frame.columns:
        flagged = frame[frame[baseline_flag_col].astype(str).str.upper() == "Y"]
        if not flagged.empty:
            frame = flagged
    elif baseline_visit_col and baseline_visit_col in frame.columns:
        baseline = frame[frame[baseline_visit_col].astype(str).str.upper().str.contains("BASE")]
        if not baseline.empty:
            frame = baseline

    frame["__PARAM_KEY__"] = (
        frame[param_col].astype(str).str.upper().str.replace(r"[^A-Z0-9]+", "_", regex=True).str.strip("_")
    )
    frame = frame.sort_values(by=[subject_id_col])
    frame = frame.drop_duplicates(subset=[subject_id_col, "__PARAM_KEY__"], keep="first")

    pivot = frame.pivot(index=subject_id_col, columns="__PARAM_KEY__", values="__VALUE_NUM__").reset_index()
    rename_map = {column: f"LAB_{column}" for column in pivot.columns if column != subject_id_col}
    pivot = pivot.rename(columns=rename_map)

    return pivot, [f"Derived {len(rename_map)} baseline lab feature(s) from ADLB."]


def _build_survival_workspace(
    question: str,
    dataset_list: list[DatasetReference],
    adsl: DatasetReference | None,
    adae: DatasetReference | None,
    adtte: DatasetReference | None,
    adlb: DatasetReference | None,
    adex: DatasetReference | None,
    spec: AnalysisSpec | None,
) -> BuiltWorkspace:
    notes: list[str] = []
    source_names = [dataset.name for dataset in dataset_list]

    if adtte is not None:
        return _build_adtte_survival_workspace(question, source_names, notes, adsl, adtte, adlb, spec)

    if adsl is None or adae is None:
        raise ValueError("A derived AE time-to-event workspace requires both ADSL and ADAE.")

    built = _build_ae_workspace(
        question,
        [dataset for dataset in dataset_list if infer_role(dataset) in {"ADSL", "ADAE", "ADLB", "ADEX", "EX", "DS"}],
        adsl,
        adae,
        adlb,
        adex,
        None,
        spec,
    )
    if not built.metadata.get("survival_time_column") or not built.metadata.get("survival_event_column"):
        raise ValueError(
            "The selected datasets do not provide a derivable survival endpoint for this question. Add ADTTE for formal endpoints or include AE timing/resolution fields for derived analyses."
        )
    if built.metadata.get("target_definition") == "time_to_resolution_grade_2_plus_dae":
        built.notes.append("Using derived AE time-to-resolution columns for the survival workspace.")
    else:
        built.notes.append("Using derived AE time-to-first-event columns for the survival workspace.")
    return built


def _build_competing_risks_workspace(
    question: str,
    dataset_list: list[DatasetReference],
    adsl: DatasetReference,
    adae: DatasetReference | None,
    adlb: DatasetReference | None,
    adex: DatasetReference | None,
    ds: DatasetReference,
    spec: AnalysisSpec | None,
) -> BuiltWorkspace:
    if adae is not None:
        built = _build_ae_workspace(question, dataset_list, adsl, adae, adlb, adex, ds, spec)
        competing_time_column = built.metadata.get("competing_time_column")
        competing_event_column = built.metadata.get("competing_event_column")
        if not competing_time_column or not competing_event_column:
            raise ValueError("The selected datasets do not expose enough disposition timing to derive competing-risk event codes.")
        built.notes.append("Using derived discontinuation vs death event codes for cumulative-incidence analysis.")
        return built

    adsl_df = _read_csv_dataset(adsl)
    ds_df = _read_csv_dataset(ds)
    subject_id_col = _find_column(adsl_df, SUBJECT_ID_HINTS)
    treatment_col = _find_column(adsl_df, TREATMENT_HINTS)
    if subject_id_col is None or treatment_col is None:
        raise ValueError("ADSL must contain subject and treatment columns for competing-risks analysis.")

    adsl_subject = adsl_df.dropna(subset=[subject_id_col]).drop_duplicates(subset=[subject_id_col], keep="first").copy()
    adsl_subject, filter_notes = _apply_cohort_filters(adsl_subject, spec)
    disposition_features, disposition_notes = _derive_disposition_features(ds_df)
    if disposition_features.empty:
        raise ValueError("Disposition/compliance data could not be converted into discontinuation and competing-event features.")

    workspace = adsl_subject.merge(disposition_features, how="left", left_on=subject_id_col, right_on=disposition_features.columns[0])
    if disposition_features.columns[0] != subject_id_col and disposition_features.columns[0] in workspace.columns:
        workspace = workspace.drop(columns=[disposition_features.columns[0]])

    discontinuation_day = pd.to_numeric(
        workspace["DS_FIRST_DISCONTINUATION_DAY"] if "DS_FIRST_DISCONTINUATION_DAY" in workspace.columns else pd.Series([pd.NA] * len(workspace), index=workspace.index),
        errors="coerce",
    )
    death_day = pd.to_numeric(
        workspace["DS_FIRST_DEATH_DAY"] if "DS_FIRST_DEATH_DAY" in workspace.columns else pd.Series([pd.NA] * len(workspace), index=workspace.index),
        errors="coerce",
    )
    event_code = pd.Series([0] * len(workspace), index=workspace.index, dtype="int64")
    event_time = pd.Series([float("nan")] * len(workspace), index=workspace.index, dtype="float64")
    discontinuation_first = discontinuation_day.notna() & (death_day.isna() | (discontinuation_day <= death_day))
    death_first = death_day.notna() & (discontinuation_day.isna() | (death_day < discontinuation_day))
    event_code.loc[discontinuation_first] = 1
    event_code.loc[death_first] = 2
    event_time.loc[discontinuation_first] = discontinuation_day.loc[discontinuation_first]
    event_time.loc[death_first] = death_day.loc[death_first]
    fallback_censor_day = pd.concat([discontinuation_day, death_day], axis=0).dropna().max()
    if pd.isna(fallback_censor_day):
        fallback_censor_day = float(spec.time_window_days) if spec and spec.time_window_days is not None else 1.0
    event_time = event_time.fillna(float(fallback_censor_day))
    workspace["COMPETING_EVENT_CODE"] = event_code
    workspace["COMPETING_EVENT_TIME"] = pd.to_numeric(event_time, errors="coerce")

    notes = [
        *filter_notes,
        *disposition_notes,
        "Using disposition timing to derive discontinuation as the event of interest and death as the competing event.",
        f"Competing-risks workspace built from {len(dataset_list)} dataset(s) with {workspace.shape[0]} subject rows.",
    ]
    return BuiltWorkspace(
        dataframe=workspace,
        source_names=[dataset.name for dataset in dataset_list],
        notes=notes,
        derived_columns=["COMPETING_EVENT_CODE", "COMPETING_EVENT_TIME"],
        metadata={
            "subject_id_column": subject_id_col,
            "treatment_column": treatment_col,
            "competing_time_column": "COMPETING_EVENT_TIME",
            "competing_event_column": "COMPETING_EVENT_CODE",
            "target_definition": spec.target_definition if spec else None,
            "cohort_filter_labels": _cohort_filter_labels(spec),
            "cohort_subject_count": int(workspace.shape[0]),
        },
    )


def _build_repeated_measures_workspace(
    question: str,
    dataset_list: list[DatasetReference],
    adsl: DatasetReference,
    adlb: DatasetReference | None,
    adae: DatasetReference | None,
    spec: AnalysisSpec | None,
) -> BuiltWorkspace:
    adsl_df = _read_csv_dataset(adsl)
    adlb_df = _read_csv_dataset(adlb) if adlb else None
    adae_df = _read_csv_dataset(adae) if adae else None

    subject_id_col = _find_column(adsl_df, SUBJECT_ID_HINTS)
    treatment_col = (spec.treatment_variable if spec and spec.treatment_variable in adsl_df.columns else None) or _find_column(
        adsl_df, TREATMENT_HINTS
    )
    if subject_id_col is None or treatment_col is None:
        raise ValueError("ADSL must contain subject and treatment columns for repeated-measures analysis.")

    adsl_subject = adsl_df.dropna(subset=[subject_id_col]).drop_duplicates(subset=[subject_id_col], keep="first").copy()
    adsl_subject, filter_notes = _apply_cohort_filters(adsl_subject, spec)

    notes = [*filter_notes]
    source_names = [dataset.name for dataset in dataset_list]

    repeated_frame = pd.DataFrame()
    repeated_notes: list[str] = []
    endpoint_label = spec.endpoint_label if spec and spec.endpoint_label else None

    if adlb_df is not None:
        repeated_frame, repeated_notes, endpoint_label = _derive_repeated_lab_workspace(question, adlb_df, spec)
    elif adae_df is not None:
        repeated_frame, repeated_notes, endpoint_label = _derive_repeated_ae_workspace(question, adae_df, spec)

    notes.extend(repeated_notes)
    if repeated_frame.empty:
        raise ValueError("No repeated-measures rows could be derived from the selected datasets.")

    workspace = adsl_subject.merge(repeated_frame, how="inner", left_on=subject_id_col, right_on="REPEATED_SUBJECT_ID")
    if "REPEATED_SUBJECT_ID" in workspace.columns and "REPEATED_SUBJECT_ID" != subject_id_col:
        workspace = workspace.drop(columns=["REPEATED_SUBJECT_ID"])

    baseline_features, baseline_notes = _derive_adsl_baseline_features(adsl_subject)
    notes.extend(baseline_notes)
    if not baseline_features.empty:
        baseline_join_key = baseline_features.columns[0]
        workspace = workspace.merge(baseline_features, how="left", left_on=subject_id_col, right_on=baseline_join_key)
        if baseline_join_key != subject_id_col and baseline_join_key in workspace.columns:
            workspace = workspace.drop(columns=[baseline_join_key])

    metadata: dict[str, str | int | list[str] | None] = {
        "subject_id_column": subject_id_col,
        "treatment_column": treatment_col,
        "repeated_time_column": "REPEATED_TIME",
        "repeated_value_column": "REPEATED_VALUE",
        "endpoint_label": endpoint_label,
        "target_definition": spec.target_definition if spec else None,
        "cohort_filter_labels": _cohort_filter_labels(spec),
        "cohort_subject_count": int(workspace.shape[0]),
    }
    notes.append(f"Repeated-measures workspace built from {len(source_names)} dataset(s) with {workspace.shape[0]} visit-level rows.")

    return BuiltWorkspace(
        dataframe=workspace,
        source_names=source_names,
        notes=notes,
        derived_columns=["REPEATED_TIME", "REPEATED_VALUE"],
        metadata=metadata,
    )


def _derive_adsl_baseline_features(adsl_subject: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    subject_id_col = _find_column(adsl_subject, SUBJECT_ID_HINTS)
    weight_col = _find_column(adsl_subject, WEIGHT_HINTS)
    if subject_id_col is None or weight_col is None:
        return pd.DataFrame(), []

    frame = adsl_subject[[subject_id_col, weight_col]].copy()
    frame["EX_WEIGHT_KG"] = pd.to_numeric(frame[weight_col], errors="coerce")
    frame["EX_WEIGHT_TIER_GT_80"] = frame["EX_WEIGHT_KG"].apply(
        lambda value: 1 if pd.notna(value) and float(value) > 80 else 0 if pd.notna(value) else pd.NA
    )
    frame["EX_WEIGHT_TIER_LABEL"] = frame["EX_WEIGHT_TIER_GT_80"].map({1: ">80KG", 0: "<=80KG"})
    return frame[[subject_id_col, "EX_WEIGHT_KG", "EX_WEIGHT_TIER_GT_80", "EX_WEIGHT_TIER_LABEL"]], [
        f"Derived baseline weight tier features from {weight_col}."
    ]


def _derive_repeated_lab_workspace(
    question: str,
    adlb_df: pd.DataFrame,
    spec: AnalysisSpec | None,
) -> tuple[pd.DataFrame, list[str], str]:
    subject_id_col = _find_column(adlb_df, SUBJECT_ID_HINTS)
    param_col = _find_column(adlb_df, PARAM_HINTS)
    value_col = _find_column(adlb_df, VALUE_HINTS)
    time_col = _find_column(adlb_df, REPEATED_TIME_HINTS)

    if subject_id_col is None or param_col is None or value_col is None:
        return pd.DataFrame(), ["ADLB did not expose subject, parameter, and value columns for repeated-measures analysis."], "Repeated lab measurement"

    frame = adlb_df[[subject_id_col, param_col, value_col] + ([time_col] if time_col else [])].copy()
    frame["__VALUE_NUM__"] = pd.to_numeric(frame[value_col], errors="coerce")
    frame = frame.dropna(subset=["__VALUE_NUM__"])
    if frame.empty:
        return pd.DataFrame(), ["ADLB repeated-measures candidate rows were all non-numeric or missing."], "Repeated lab measurement"

    selected_parameter = _select_repeated_parameter(question, frame[param_col])
    if selected_parameter:
        frame = frame[frame[param_col].astype(str).str.upper() == selected_parameter].copy()
    endpoint_label = f"Repeated lab measurement: {selected_parameter}" if selected_parameter else "Repeated lab measurement"

    if time_col:
        parsed_time = pd.to_numeric(frame[time_col], errors="coerce")
        if parsed_time.notna().any():
            frame["REPEATED_TIME"] = parsed_time
        else:
            ordered_values = list(dict.fromkeys(frame[time_col].astype(str).tolist()))
            frame["REPEATED_TIME"] = frame[time_col].astype(str).map({value: index + 1 for index, value in enumerate(ordered_values)})
    else:
        frame["REPEATED_TIME"] = frame.groupby(subject_id_col).cumcount() + 1

    return (
        frame.rename(columns={subject_id_col: "REPEATED_SUBJECT_ID"})[["REPEATED_SUBJECT_ID", "REPEATED_TIME", "__VALUE_NUM__"]]
        .rename(columns={"__VALUE_NUM__": "REPEATED_VALUE"})
        .dropna(subset=["REPEATED_TIME", "REPEATED_VALUE"]),
        [f"Derived repeated-measures lab rows{f' for {selected_parameter}' if selected_parameter else ''}."],
        endpoint_label,
    )


def _derive_repeated_ae_workspace(
    question: str,
    adae_df: pd.DataFrame,
    spec: AnalysisSpec | None,
) -> tuple[pd.DataFrame, list[str], str]:
    subject_id_col = _find_column(adae_df, SUBJECT_ID_HINTS)
    grade_col = _find_column(adae_df, GRADE_HINTS)
    day_col = _find_column(adae_df, DAY_HINTS)
    term_col = _find_column(adae_df, TERM_HINTS)

    if subject_id_col is None or grade_col is None:
        return pd.DataFrame(), ["ADAE did not expose subject and grade columns for repeated-measures analysis."], "Repeated adverse-event burden"

    frame = adae_df[[subject_id_col, grade_col] + ([day_col] if day_col else []) + ([term_col] if term_col else [])].copy()
    frame["__GRADE_NUM__"] = pd.to_numeric(frame[grade_col], errors="coerce")
    frame = frame.dropna(subset=["__GRADE_NUM__"])
    if frame.empty:
        return pd.DataFrame(), ["ADAE repeated-measures candidate rows were all non-numeric or missing."], "Repeated adverse-event burden"

    term_filters = _parse_term_filters(question, spec)
    if term_filters and term_col:
        lower_terms = frame[term_col].astype(str).str.lower()
        frame = frame[lower_terms.apply(lambda value: any(term in value for term in term_filters))].copy()
    if frame.empty:
        return pd.DataFrame(), ["No repeated ADAE rows matched the requested term filters."], "Repeated adverse-event burden"

    if day_col:
        frame["REPEATED_TIME"] = pd.to_numeric(frame[day_col], errors="coerce")
    else:
        frame["REPEATED_TIME"] = frame.groupby(subject_id_col).cumcount() + 1

    return (
        frame.rename(columns={subject_id_col: "REPEATED_SUBJECT_ID"})[["REPEATED_SUBJECT_ID", "REPEATED_TIME", "__GRADE_NUM__"]]
        .rename(columns={"__GRADE_NUM__": "REPEATED_VALUE"})
        .dropna(subset=["REPEATED_TIME", "REPEATED_VALUE"]),
        ["Derived repeated-measures AE rows using event grade over time."],
        "Repeated adverse-event grade trajectory",
    )


def _select_repeated_parameter(question: str, parameter_series: pd.Series) -> str | None:
    values = [str(value).strip().upper() for value in parameter_series.astype(str) if str(value).strip()]
    if not values:
        return None
    unique_values = list(dict.fromkeys(values))
    question_upper = question.upper()
    for value in unique_values:
        if value and value in question_upper:
            return value
    if len(unique_values) == 1:
        return unique_values[0]
    return parameter_series.astype(str).str.upper().value_counts().idxmax()


def _derive_exposure_features(adex_df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    subject_id_col = _find_column(adex_df, SUBJECT_ID_HINTS)
    dose_col = _find_column(adex_df, DOSE_HINTS)
    start_day_col = _find_column(adex_df, EXPOSURE_START_DAY_HINTS)
    end_day_col = _find_column(adex_df, EXPOSURE_END_DAY_HINTS)

    if subject_id_col is None:
        return pd.DataFrame(), ["Exposure dataset was provided but did not expose a subject identifier."]

    features = adex_df[[subject_id_col]].drop_duplicates().copy()
    notes: list[str] = []

    if dose_col is not None:
        frame = adex_df[[subject_id_col, dose_col]].copy()
        frame["__DOSE_NUM__"] = pd.to_numeric(frame[dose_col], errors="coerce")
        dose_summary = (
            frame.groupby(subject_id_col, dropna=False)["__DOSE_NUM__"]
            .agg(["max", "mean", "first", "last"])
            .reset_index()
            .rename(
                columns={
                    "max": "EX_MAX_DOSE",
                    "mean": "EX_MEAN_DOSE",
                    "first": "EX_FIRST_DOSE",
                    "last": "EX_LAST_DOSE",
                }
            )
        )
        features = features.merge(dose_summary, how="left", on=subject_id_col)
        notes.append(f"Derived exposure dose features from {dose_col}.")

    if start_day_col is not None:
        frame = adex_df[[subject_id_col, start_day_col]].copy()
        frame["__START_DAY_NUM__"] = pd.to_numeric(frame[start_day_col], errors="coerce")
        start_summary = (
            frame.groupby(subject_id_col, dropna=False)["__START_DAY_NUM__"]
            .min()
            .reset_index(name="EX_FIRST_EXPOSURE_DAY")
        )
        features = features.merge(start_summary, how="left", on=subject_id_col)

    if end_day_col is not None:
        frame = adex_df[[subject_id_col, end_day_col]].copy()
        frame["__END_DAY_NUM__"] = pd.to_numeric(frame[end_day_col], errors="coerce")
        end_summary = (
            frame.groupby(subject_id_col, dropna=False)["__END_DAY_NUM__"]
            .max()
            .reset_index(name="EX_LAST_EXPOSURE_DAY")
        )
        features = features.merge(end_summary, how="left", on=subject_id_col)

    if "EX_FIRST_EXPOSURE_DAY" in features.columns and "EX_LAST_EXPOSURE_DAY" in features.columns:
        features["EX_EXPOSURE_DAY_SPAN"] = features["EX_LAST_EXPOSURE_DAY"] - features["EX_FIRST_EXPOSURE_DAY"]
        notes.append("Derived exposure timing span from start and end exposure days.")

    if features.shape[1] == 1:
        return pd.DataFrame(), ["Exposure dataset was provided but no numeric dose or timing features could be derived."]
    return features, notes


def _derive_disposition_features(ds_df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    subject_id_col = _find_column(ds_df, SUBJECT_ID_HINTS)
    term_col = _find_column(ds_df, DISPOSITION_TERM_HINTS)
    day_col = _find_column(ds_df, DISPOSITION_DAY_HINTS)

    if subject_id_col is None or term_col is None:
        return pd.DataFrame(), ["Disposition dataset was provided but did not expose subject and status/term columns."]

    frame = ds_df[[subject_id_col, term_col] + ([day_col] if day_col else [])].copy()
    frame["__TERM_LOWER__"] = frame[term_col].astype(str).str.lower()
    if day_col:
        frame["__DAY_NUM__"] = pd.to_numeric(frame[day_col], errors="coerce")
    else:
        frame["__DAY_NUM__"] = pd.NA

    summary = (
        frame.groupby(subject_id_col, dropna=False)
        .agg(
            DS_DISCONTINUATION_FLAG=("__TERM_LOWER__", lambda values: int(any(any(token in value for token in ("discontinu", "non-persist", "stop treatment")) for value in values))),
            DS_INTERRUPTION_FLAG=("__TERM_LOWER__", lambda values: int(any("interrupt" in value for value in values))),
            DS_REDUCTION_FLAG=("__TERM_LOWER__", lambda values: int(any("reduction" in value or "dose reduc" in value for value in values))),
            DS_DEATH_FLAG=("__TERM_LOWER__", lambda values: int(any("death" in value or "died" in value for value in values))),
        )
        .reset_index()
    )

    if day_col:
        discontinuation_days = frame[frame["__TERM_LOWER__"].str.contains("discontinu|non-persist|stop treatment", na=False)]
        if not discontinuation_days.empty:
            earliest = discontinuation_days.groupby(subject_id_col, dropna=False)["__DAY_NUM__"].min().reset_index(name="DS_FIRST_DISCONTINUATION_DAY")
            summary = summary.merge(earliest, how="left", on=subject_id_col)
        death_days = frame[frame["__TERM_LOWER__"].str.contains("death|died", na=False)]
        if not death_days.empty:
            earliest_death = death_days.groupby(subject_id_col, dropna=False)["__DAY_NUM__"].min().reset_index(name="DS_FIRST_DEATH_DAY")
            summary = summary.merge(earliest_death, how="left", on=subject_id_col)

    return summary, ["Derived discontinuation/interruption/reduction/death features from disposition/compliance data."]


def _build_adtte_survival_workspace(
    question: str,
    source_names: list[str],
    notes: list[str],
    adsl: DatasetReference | None,
    adtte: DatasetReference,
    adlb: DatasetReference | None,
    spec: AnalysisSpec | None,
) -> BuiltWorkspace:
    adtte_df = _read_csv_dataset(adtte)
    adsl_df = _read_csv_dataset(adsl) if adsl else None
    adlb_df = _read_csv_dataset(adlb) if adlb else None

    subject_id_col = _find_column(adtte_df, SUBJECT_ID_HINTS)
    if subject_id_col is None:
        raise ValueError("ADTTE dataset must contain a subject identifier such as USUBJID.")

    parameter_col = _find_column(adtte_df, ("PARAMCD", "PARAM"))
    endpoint_filter = _infer_survival_endpoint_filter(question)
    if parameter_col is not None:
        unique_parameters = sorted({str(value).strip() for value in adtte_df[parameter_col].astype(str) if str(value).strip()})
        if endpoint_filter is not None:
            filtered = adtte_df[adtte_df[parameter_col].astype(str).str.upper().str.contains(endpoint_filter)]
            if not filtered.empty:
                adtte_df = filtered.copy()
                notes.append(f"Filtered ADTTE to endpoint {endpoint_filter} using {parameter_col}.")
        elif len(unique_parameters) > 1:
            raise ValueError(
                f"ADTTE contains multiple endpoints in {parameter_col} ({', '.join(unique_parameters[:6])}). Filter to one endpoint before Kaplan-Meier or Cox analysis."
            )

    time_col = (spec.time_variable if spec and spec.time_variable and spec.time_variable in adtte_df.columns else None) or _find_column(
        adtte_df, TIME_HINTS
    )
    censor_col = (spec.event_variable if spec and spec.event_variable and spec.event_variable in adtte_df.columns else None) or _find_column(
        adtte_df, CENSOR_HINTS
    )
    treatment_col = (
        (spec.treatment_variable if spec and spec.treatment_variable and spec.treatment_variable in adtte_df.columns else None)
        or _find_column(adtte_df, TREATMENT_HINTS)
    )

    if time_col is None:
        raise ValueError("ADTTE dataset must contain a numeric time-to-event column such as AVAL.")
    if censor_col is None:
        raise ValueError("ADTTE dataset must contain a censoring/event indicator such as CNSR or STATUS.")

    adtte_subject = adtte_df.dropna(subset=[subject_id_col]).drop_duplicates(subset=[subject_id_col], keep="first").copy()
    adtte_subject["SURVIVAL_TIME"] = pd.to_numeric(adtte_subject[time_col], errors="coerce")
    adtte_subject["SURVIVAL_EVENT"] = _derive_survival_event_indicator(adtte_subject[censor_col], censor_col)
    adtte_subject = adtte_subject.dropna(subset=["SURVIVAL_TIME"])
    notes.append(f"Derived survival endpoint using {time_col} with censor/event column {censor_col}.")

    workspace = adtte_subject.copy()
    base_subject_id_col = subject_id_col
    base_treatment_col = treatment_col

    if adsl_df is not None:
        adsl_subject_id_col = _find_column(adsl_df, SUBJECT_ID_HINTS)
        if adsl_subject_id_col is None:
            raise ValueError("ADSL dataset must contain a subject identifier such as USUBJID.")
        adsl_treatment_col = (
            (spec.treatment_variable if spec and spec.treatment_variable and spec.treatment_variable in adsl_df.columns else None)
            or _find_column(adsl_df, TREATMENT_HINTS)
        )
        adsl_subject = adsl_df.dropna(subset=[adsl_subject_id_col]).drop_duplicates(subset=[adsl_subject_id_col], keep="first").copy()
        adsl_subject, filter_notes = _apply_cohort_filters(adsl_subject, spec)
        notes.extend(filter_notes)
        workspace = adsl_subject.merge(
            adtte_subject[[subject_id_col, "SURVIVAL_TIME", "SURVIVAL_EVENT"]],
            how="inner",
            left_on=adsl_subject_id_col,
            right_on=subject_id_col,
        )
        if subject_id_col != adsl_subject_id_col and subject_id_col in workspace.columns:
            workspace = workspace.drop(columns=[subject_id_col])
        base_subject_id_col = adsl_subject_id_col
        base_treatment_col = adsl_treatment_col or treatment_col
    elif spec and spec.cohort_filters:
        workspace, filter_notes = _apply_cohort_filters(workspace, spec)
        notes.extend(filter_notes)

    if base_treatment_col is None:
        base_treatment_col = _find_column(workspace, TREATMENT_HINTS)
    if base_treatment_col is None:
        raise ValueError("A survival workspace requires a treatment/grouping column such as TRT01A or ARM.")

    derived_columns = ["SURVIVAL_TIME", "SURVIVAL_EVENT"]

    if adlb_df is not None:
        lab_features, lab_notes = _derive_lab_features(adlb_df)
        notes.extend(lab_notes)
        if not lab_features.empty:
            lab_join_key = lab_features.columns[0]
            workspace = workspace.merge(lab_features, how="left", left_on=base_subject_id_col, right_on=lab_join_key)
            if lab_join_key != base_subject_id_col and lab_join_key in workspace.columns:
                workspace = workspace.drop(columns=[lab_join_key])
            derived_columns.extend([column for column in workspace.columns if column.startswith("LAB_")])

    metadata: dict[str, str | int | list[str] | None] = {
        "subject_id_column": base_subject_id_col,
        "treatment_column": base_treatment_col,
        "survival_time_column": "SURVIVAL_TIME",
        "survival_event_column": "SURVIVAL_EVENT",
        "survival_source": "ADTTE",
        "cohort_filter_labels": _cohort_filter_labels(spec),
        "cohort_subject_count": int(workspace.shape[0]),
    }
    notes.append(f"Survival workspace built from {len(source_names)} dataset(s) with {workspace.shape[0]} subject rows.")

    return BuiltWorkspace(
        dataframe=workspace,
        source_names=source_names,
        notes=notes,
        derived_columns=sorted(set(derived_columns)),
        metadata=metadata,
    )


def _infer_survival_endpoint_filter(question: str) -> str | None:
    lowered = question.lower()
    if "overall survival" in lowered or re.search(r"\bos\b", lowered):
        return "OS"
    if "progression-free survival" in lowered or re.search(r"\bpfs\b", lowered):
        return "PFS"
    return None


def _derive_survival_event_indicator(series: pd.Series, column_name: str) -> pd.Series:
    normalized_name = _normalize_token(column_name)
    normalized = series.astype(str).str.strip().str.upper()
    numeric = pd.to_numeric(series, errors="coerce")

    if normalized_name.startswith("cnsr") or "censor" in normalized_name:
        if numeric.notna().any():
            return numeric.apply(lambda value: 1 if pd.notna(value) and float(value) == 0 else 0 if pd.notna(value) else pd.NA)
        return normalized.map({"0": 1, "1": 0, "N": 1, "Y": 0, "FALSE": 1, "TRUE": 0})

    if numeric.notna().any():
        return numeric.apply(lambda value: 1 if pd.notna(value) and float(value) > 0 else 0 if pd.notna(value) else pd.NA)

    return normalized.map({"1": 1, "0": 0, "Y": 1, "N": 0, "TRUE": 1, "FALSE": 0})
